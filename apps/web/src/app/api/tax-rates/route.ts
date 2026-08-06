import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const taxRateCreateSchema = z.object({
  taxProfileId: z.string().min(1),
  rate: z.coerce.number().min(0).max(100),
  effectiveFrom: z.string().datetime().nullable().optional(),
  effectiveTo: z.string().datetime().nullable().optional(),
});

/** GET /api/tax-rates（分页 + taxProfileId 过滤，Sprint 3C-4 Price Foundation） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "tax-rate:view");
  if (denied) return denied;
  requestLog(request, user?.id, "tax-rate.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const taxProfileId = searchParams.get("taxProfileId")?.trim();
  const isActive = searchParams.get("isActive")?.trim();

  const where = {
    deletedAt: null,
    ...(taxProfileId ? { taxProfileId } : {}),
    ...(isActive === "true" ? { isActive: true } : isActive === "false" ? { isActive: false } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.taxRate.count({ where }),
    prisma.taxRate.findMany({
      where,
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      skip,
      take,
      include: {
        taxProfile: { select: { id: true, code: true, name: true, country: true, taxIncluded: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/tax-rates（创建税率：taxProfileId 必填，时间窗口 effectiveFrom/effectiveTo） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "tax-rate:create");
  if (denied) return denied;
  requestLog(request, user?.id, "tax-rate.create");

  const meta = requestMeta(request);
  const parsed = taxRateCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const profile = await prisma.taxProfile.findFirst({ where: { id: parsed.data.taxProfileId, deletedAt: null } });
  if (!profile) return failConflict(ERROR_CODES.NOT_FOUND, "关联税率档案不存在");

  const created = await prisma.taxRate.create({
    data: {
      taxProfileId: parsed.data.taxProfileId,
      rate: parsed.data.rate,
      effectiveFrom: parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : null,
      effectiveTo: parsed.data.effectiveTo ? new Date(parsed.data.effectiveTo) : null,
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "tax-rate.create",
    entityType: "taxRate",
    entityId: created.id,
    afterData: { taxProfileId: created.taxProfileId, rate: created.rate },
    ...meta,
  });

  return ok(created, undefined, 201);
}
