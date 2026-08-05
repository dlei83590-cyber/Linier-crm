import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const contactCreateSchema = z.object({
  name: z.string().min(1).max(100),
  title: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  wechat: z.string().max(100).optional(),
  isPrimary: z.boolean().default(false),
  sort: z.number().int().default(0),
});

/** 通过 supplier.partnerId 定位 BusinessPartner（Partner 级共享） */
async function resolvePartnerId(supplierId: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, deletedAt: null }, select: { partnerId: true } });
  return supplier?.partnerId ?? null;
}

/** GET /api/suppliers/:id/contacts（联系人，PartnerContact 共享表） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-contact:view");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-contact.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const partnerId = await resolvePartnerId(id);
  if (!partnerId) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");

  const [total, items] = await Promise.all([
    prisma.partnerContact.count({ where: { partnerId, deletedAt: null } }),
    prisma.partnerContact.findMany({
      where: { partnerId, deletedAt: null },
      orderBy: [{ isPrimary: "desc" }, { sort: "asc" }],
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/suppliers/:id/contacts（新增联系人，写入 PartnerContact；isPrimary 时清除其他主联系人） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-contact:create");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-contact.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = contactCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const partnerId = await resolvePartnerId(id);
  if (!partnerId) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");

  const created = await prisma.$transaction(async (tx) => {
    if (parsed.data.isPrimary) {
      await tx.partnerContact.updateMany({
        where: { partnerId, deletedAt: null },
        data: { isPrimary: false, updatedById: user?.id ?? null },
      });
    }
    return tx.partnerContact.create({
      data: { ...parsed.data, partnerId, createdById: user!.id, updatedById: user!.id },
    });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "partner-contact.create",
    entityType: "partner-contact",
    entityId: created.id,
    meta: { supplierId: id, partnerId, name: created.name },
    ...meta,
  });

  return ok(created, undefined, 201);
}
