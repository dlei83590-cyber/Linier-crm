import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bankAccountCreateSchema = z.object({
  bankName: z.string().min(1).max(200),
  accountName: z.string().min(1).max(200),
  accountNo: z.string().min(1).max(100),
  currency: z.string().max(10).default("CNY"),
  isDefault: z.boolean().default(false),
  swiftCode: z.string().max(20).optional(),
});

/** GET /api/suppliers/:id/bank-accounts（银行账户列表，PartnerBankAccount 共享表） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-bank-account:view");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-bank-account.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const supplier = await prisma.supplier.findFirst({ where: { id, deletedAt: null }, select: { partnerId: true } });
  if (!supplier) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");

  const [total, items] = await Promise.all([
    prisma.partnerBankAccount.count({ where: { partnerId: supplier.partnerId, deletedAt: null } }),
    prisma.partnerBankAccount.findMany({
      where: { partnerId: supplier.partnerId, deletedAt: null },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/suppliers/:id/bank-accounts（新增银行账户，写入 PartnerBankAccount；isDefault 时清除其他默认账户） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-bank-account:create");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-bank-account.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = bankAccountCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const supplier = await prisma.supplier.findFirst({ where: { id, deletedAt: null }, select: { partnerId: true } });
  if (!supplier) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");

  const created = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault) {
      await tx.partnerBankAccount.updateMany({
        where: { partnerId: supplier.partnerId, deletedAt: null },
        data: { isDefault: false, updatedById: user?.id ?? null },
      });
    }
    return tx.partnerBankAccount.create({
      data: { ...parsed.data, partnerId: supplier.partnerId, createdById: user!.id, updatedById: user!.id },
    });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "partner-bank-account.create",
    entityType: "partner-bank-account",
    entityId: created.id,
    meta: { supplierId: id, partnerId: supplier.partnerId, bankName: created.bankName, accountNo: created.accountNo },
    ...meta,
  });

  return ok(created, undefined, 201);
}
