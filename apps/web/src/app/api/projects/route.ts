import { NextRequest } from "next/server";
import type { ProjectStage, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const projectCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  customerId: z.string().min(1),
  stage: z.enum(["LEAD", "QUALIFIED", "SOLUTION", "QUOTATION", "SAMPLING", "TESTING", "SMALL_BATCH", "MASS_SUPPLY", "PAUSED", "FAILED", "CLOSED"]).optional(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).nullable().optional(),
  ownerId: z.string().min(1).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  expectedContractAmount: z.coerce.number().nonnegative().nullable().optional(),
  expectedProfit: z.coerce.number().nullable().optional(),
  expectedGrossMarginRate: z.coerce.number().min(0).max(100).nullable().optional(),
  paymentStatus: z.enum(["UNPAID", "PARTIAL", "PAID", "OVERDUE"]).optional(),
});

/** GET /api/projects（分页 + code/name/stage/customerId/ownerId/priority 过滤，Sprint 3C-5 Project Foundation） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const stage = searchParams.get("stage")?.trim();
  const customerId = searchParams.get("customerId")?.trim();
  const ownerId = searchParams.get("ownerId")?.trim();
  const priority = searchParams.get("priority")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code } } : {}),
    ...(name ? { name: { contains: name } } : {}),
    ...(stage ? { stage: stage as ProjectStage } : {}),
    ...(customerId ? { customerId } : {}),
    ...(ownerId ? { ownerId } : {}),
    ...(priority ? { priority } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        customer: { select: { id: true, code: true, name: true, type: true } },
        opportunity: { select: { id: true, code: true, name: true, stage: true } },
        closure: { select: { id: true, closedAt: true, reason: true } },
        _count: {
          select: {
            members: { where: { deletedAt: null, isActive: true } },
            tasks: { where: { deletedAt: null, status: { notIn: ["DONE", "CANCELLED"] } } },
            risks: { where: { deletedAt: null, status: { not: "CLOSED" } } },
          },
        },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/projects（创建项目：code 唯一；禁止通过此接口模拟 Opportunity 转换，转换走唯一入口 convert） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project:create");
  if (denied) return denied;
  requestLog(request, user?.id, "project.create");

  const meta = requestMeta(request);
  const parsed = projectCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const customer = await prisma.businessPartner.findFirst({ where: { id: parsed.data.customerId, deletedAt: null } });
  if (!customer) return failConflict(ERROR_CODES.NOT_FOUND, "关联客户不存在");

  const existing = await prisma.project.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "项目编码已存在");
  }

  const created = await prisma.project.create({
    data: {
      code: parsed.data.code,
      name: parsed.data.name,
      customerId: parsed.data.customerId,
      stage: (parsed.data.stage as ProjectStage) ?? "SAMPLING",
      priority: parsed.data.priority ?? null,
      ownerId: parsed.data.ownerId ?? null,
      description: parsed.data.description ?? null,
      expectedContractAmount: parsed.data.expectedContractAmount ?? null,
      expectedProfit: parsed.data.expectedProfit ?? null,
      expectedGrossMarginRate: parsed.data.expectedGrossMarginRate ?? null,
      paymentStatus: (parsed.data.paymentStatus as PaymentStatus) ?? "UNPAID",
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project.create",
    entityType: "project",
    entityId: created.id,
    afterData: { code: created.code, name: created.name, customerId: created.customerId },
    ...meta,
  });

  return ok(created, undefined, 201);
}
