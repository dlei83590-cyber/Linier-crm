import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import type { ProjectStage, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { buildFollowUpInfo } from "@/lib/api/opportunity-followup";
import { z } from "zod";

export const dynamic = "force-dynamic";

const opportunityCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  customerId: z.string().min(1),
  stage: z.enum(["LEAD", "QUALIFIED", "SOLUTION", "QUOTATION", "SAMPLING", "TESTING", "SMALL_BATCH", "MASS_SUPPLY", "PAUSED", "FAILED", "CLOSED"]).optional(),
  customerInvestment: z.coerce.number().nonnegative().optional(),
  expectedRevenue: z.coerce.number().nonnegative().optional(),
  expectedCost: z.coerce.number().nonnegative().optional(),
  grossProfit: z.coerce.number().optional(),
  expenseBudget: z.coerce.number().nonnegative().optional(),
  salesTarget: z.coerce.number().nonnegative().optional(),
  paymentStatus: z.enum(["UNPAID", "PARTIAL", "PAID", "OVERDUE"]).optional(),
  competitors: z.array(z.object({ name: z.string(), note: z.string().optional() })).optional(),
  successProbability: z.coerce.number().min(0).max(100).optional(),
  ownerId: z.string().min(1).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
});

/** GET /api/project-opportunities（分页 + code/name/stage/customerId/ownerId 过滤，Sprint 3C-5 Project Foundation） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-opportunity:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-opportunity.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const stage = searchParams.get("stage")?.trim();
  const customerId = searchParams.get("customerId")?.trim();
  const ownerId = searchParams.get("ownerId")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code } } : {}),
    ...(name ? { name: { contains: name } } : {}),
    ...(stage ? { stage: stage as ProjectStage } : {}),
    ...(customerId ? { customerId } : {}),
    ...(ownerId ? { ownerId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.projectOpportunity.count({ where }),
    prisma.projectOpportunity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        customer: { select: { id: true, code: true, name: true, type: true } },
        project: { select: { id: true, code: true, name: true, stage: true } },
      },
    }),
  ]);

  // 商机跟进 MVP：本页商机客户 → 最近一次 FOLLOW_UP（CustomerActivity.createdAt，BP 维度）。
  // 每客户取最新一条（orderBy createdAt desc 后首次出现即最新）；商机必有客户（customerId 非空）。
  const customerIds = [...new Set(items.map((i) => i.customerId))];
  const latestFollowUpByPartner = new Map<string, Date>();
  if (customerIds.length > 0) {
    const followUps = await prisma.customerActivity.findMany({
      where: { businessPartnerId: { in: customerIds }, activityType: "FOLLOW_UP", deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { businessPartnerId: true, createdAt: true },
    });
    for (const f of followUps) {
      if (!latestFollowUpByPartner.has(f.businessPartnerId)) {
        latestFollowUpByPartner.set(f.businessPartnerId, f.createdAt);
      }
    }
  }

  const rows = items.map((opp) => ({
    ...opp,
    ...buildFollowUpInfo(latestFollowUpByPartner.get(opp.customerId) ?? null, opp.createdAt),
  }));

  return ok(rows, { page, pageSize, total });
}

/** POST /api/project-opportunities（创建销售机会：code 唯一） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-opportunity:create");
  if (denied) return denied;
  requestLog(request, user?.id, "project-opportunity.create");

  const meta = requestMeta(request);
  const parsed = opportunityCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const customer = await prisma.businessPartner.findFirst({ where: { id: parsed.data.customerId, deletedAt: null } });
  if (!customer) return failConflict(ERROR_CODES.NOT_FOUND, "关联客户不存在");

  const existing = await prisma.projectOpportunity.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "机会编码已存在");
  }

  const created = await prisma.projectOpportunity.create({
    data: {
      code: parsed.data.code,
      name: parsed.data.name,
      customerId: parsed.data.customerId,
      stage: (parsed.data.stage as ProjectStage) ?? "LEAD",
      customerInvestment: parsed.data.customerInvestment ?? null,
      expectedRevenue: parsed.data.expectedRevenue ?? null,
      expectedCost: parsed.data.expectedCost ?? null,
      grossProfit: parsed.data.grossProfit ?? null,
      expenseBudget: parsed.data.expenseBudget ?? null,
      salesTarget: parsed.data.salesTarget ?? null,
      paymentStatus: (parsed.data.paymentStatus as PaymentStatus) ?? "UNPAID",
      competitors:
        parsed.data.competitors === undefined
          ? undefined
          : (parsed.data.competitors as Prisma.InputJsonValue),
      successProbability: parsed.data.successProbability ?? null,
      ownerId: parsed.data.ownerId ?? null,
      description: parsed.data.description ?? null,
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-opportunity.create",
    entityType: "projectOpportunity",
    entityId: created.id,
    afterData: { code: created.code, name: created.name, customerId: created.customerId },
    ...meta,
  });

  return ok(created, undefined, 201);
}
