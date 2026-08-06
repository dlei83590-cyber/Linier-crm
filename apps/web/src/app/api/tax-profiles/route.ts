import { NextRequest } from "next/server";
import type { TaxRateType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const taxProfileCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  country: z.string().max(10).nullable().optional(),
  region: z.string().max(50).nullable().optional(),
  taxIncluded: z.boolean().optional(),
  rateType: z.enum(["ZERO", "SIX", "THIRTEEN", "EXEMPT", "CUSTOM"]),
  rate: z.coerce.number().min(0).max(100).nullable().optional(),
});

/** GET /api/tax-profiles（分页 + code/name/country/rateType 过滤，Sprint 3C-4 Price Foundation） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "tax-profile:view");
  if (denied) return denied;
  requestLog(request, user?.id, "tax-profile.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const country = searchParams.get("country")?.trim();
  const rateType = searchParams.get("rateType")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code } } : {}),
    ...(name ? { name: { contains: name } } : {}),
    ...(country ? { country } : {}),
    ...(rateType ? { rateType: rateType as TaxRateType } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.taxProfile.count({ where }),
    prisma.taxProfile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        _count: { select: { taxRates: { where: { deletedAt: null } }, taxProfileRules: { where: { isActive: true } } } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/tax-profiles（创建税率档案：code 唯一；多国复用，不写死核心代码） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "tax-profile:create");
  if (denied) return denied;
  requestLog(request, user?.id, "tax-profile.create");

  const meta = requestMeta(request);
  const parsed = taxProfileCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.taxProfile.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "税率档案编码已存在");
  }

  const created = await prisma.taxProfile.create({
    data: {
      code: parsed.data.code,
      name: parsed.data.name,
      country: parsed.data.country ?? null,
      region: parsed.data.region ?? null,
      taxIncluded: parsed.data.taxIncluded ?? false,
      rateType: parsed.data.rateType as TaxRateType,
      rate: parsed.data.rate ?? null,
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "tax-profile.create",
    entityType: "taxProfile",
    entityId: created.id,
    afterData: { code: created.code, name: created.name, country: created.country, rate: created.rate },
    ...meta,
  });

  return ok(created, undefined, 201);
}
