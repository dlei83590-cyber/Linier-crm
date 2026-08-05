import { NextRequest } from "next/server";
import type { CustomerLevel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const customerCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  shortName: z.string().max(100).optional(),
  partnerId: z.string().min(1).optional(),
  level: z.enum(["VIP", "KEY", "REGULAR", "PROSPECT"]).optional(),
  industryId: z.string().min(1).optional(),
  region: z.string().max(50).optional(),
  sourceChannel: z.string().max(50).optional(),
  companySize: z.string().max(50).optional(),
  foundedDate: z.string().datetime().optional(),
  website: z.string().max(200).optional(),
});

/** GET /api/customers（分页 + code/name/level/region 搜索，Sprint 3C-1 Customer Foundation） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer:view");
  if (denied) return denied;
  requestLog(request, user?.id, "customer.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const level = searchParams.get("level")?.trim();
  const region = searchParams.get("region")?.trim();
  const industryId = searchParams.get("industryId")?.trim();
  const partnerId = searchParams.get("partnerId")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code } } : {}),
    ...(name ? { name: { contains: name } } : {}),
    ...(level ? { level: level as CustomerLevel } : {}),
    ...(region ? { region } : {}),
    ...(industryId ? { industryId } : {}),
    ...(partnerId ? { partnerId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        industry: { select: { id: true, code: true, name: true } },
        _count: { select: { contacts: { where: { deletedAt: null } }, addresses: { where: { deletedAt: null } }, tags: { where: { deletedAt: null } } } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/customers（创建客户主档） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer:create");
  if (denied) return denied;
  requestLog(request, user?.id, "customer.create");

  const meta = requestMeta(request);
  const parsed = customerCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  if (parsed.data.partnerId) {
    const partner = await prisma.businessPartner.findFirst({ where: { id: parsed.data.partnerId, deletedAt: null } });
    if (!partner) return failConflict(ERROR_CODES.NOT_FOUND, "关联往来单位不存在");
  }
  if (parsed.data.industryId) {
    const industry = await prisma.industry.findFirst({ where: { id: parsed.data.industryId, deletedAt: null } });
    if (!industry) return failConflict(ERROR_CODES.NOT_FOUND, "行业不存在");
  }

  const existing = await prisma.customer.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "客户编码已存在");
  }

  const created = await prisma.customer.create({
    data: {
      ...parsed.data,
      foundedDate: parsed.data.foundedDate ? new Date(parsed.data.foundedDate) : null,
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "customer.create",
    entityType: "customer",
    entityId: created.id,
    afterData: { code: created.code, name: created.name },
    ...meta,
  });

  return ok(created, undefined, 201);
}
