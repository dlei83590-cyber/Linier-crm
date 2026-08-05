import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const creditUpsertSchema = z.object({
  creditLimit: z.coerce.number().nonnegative().optional(),
  usedCredit: z.coerce.number().nonnegative().optional(),
  rating: z.enum(["AAA", "AA", "A", "BBB", "BB", "B", "C"]).optional(),
  status: z.enum(["NORMAL", "WATCH", "FROZEN", "CLOSED"]).optional(),
  reviewDate: z.string().datetime().optional(),
  version: z.number().int().positive().optional(),
});

/** GET /api/suppliers/:id/credit（PartnerCredit 共享信用，1:1） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-credit:view");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-credit.get");

  const { id } = await params;
  const supplier = await prisma.supplier.findFirst({ where: { id, deletedAt: null }, select: { partnerId: true } });
  if (!supplier) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");

  const credit = await prisma.partnerCredit.findFirst({
    where: { partnerId: supplier.partnerId, deletedAt: null },
  });
  return ok(credit);
}

/** POST /api/suppliers/:id/credit（创建或更新 PartnerCredit，upsert；乐观锁 version 可选） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-credit:create");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-credit.upsert");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = creditUpsertSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const supplier = await prisma.supplier.findFirst({ where: { id, deletedAt: null }, select: { partnerId: true } });
  if (!supplier) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");

  const existing = await prisma.partnerCredit.findFirst({ where: { partnerId: supplier.partnerId, deletedAt: null } });
  if (existing && parsed.data.version !== undefined && existing.version !== parsed.data.version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.partnerCredit.upsert({
    where: { partnerId: supplier.partnerId },
    update: {
      ...(parsed.data.creditLimit !== undefined ? { creditLimit: parsed.data.creditLimit } : {}),
      ...(parsed.data.usedCredit !== undefined ? { usedCredit: parsed.data.usedCredit } : {}),
      ...(parsed.data.rating !== undefined ? { rating: parsed.data.rating } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.reviewDate !== undefined ? { reviewDate: new Date(parsed.data.reviewDate) } : {}),
      version: { increment: 1 },
      updatedById: user!.id,
    },
    create: {
      partnerId: supplier.partnerId,
      creditLimit: parsed.data.creditLimit ?? null,
      usedCredit: parsed.data.usedCredit ?? 0,
      rating: parsed.data.rating ?? "B",
      status: parsed.data.status ?? "NORMAL",
      reviewDate: parsed.data.reviewDate ? new Date(parsed.data.reviewDate) : null,
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "partner-credit.upsert",
    entityType: "partner-credit",
    entityId: updated.id,
    meta: { supplierId: id, partnerId: supplier.partnerId, creditLimit: updated.creditLimit, rating: updated.rating },
    ...meta,
  });

  return ok(updated, undefined, existing ? 200 : 201);
}
