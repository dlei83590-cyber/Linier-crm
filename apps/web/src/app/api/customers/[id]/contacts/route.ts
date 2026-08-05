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

/** GET /api/customers/:id/contacts（联系人列表） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-contact:view");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-contact.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const customer = await prisma.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!customer) return failNotFound(ERROR_CODES.NOT_FOUND, "客户不存在");

  const [total, items] = await Promise.all([
    prisma.customerContact.count({ where: { customerId: id, deletedAt: null } }),
    prisma.customerContact.findMany({
      where: { customerId: id, deletedAt: null },
      orderBy: [{ isPrimary: "desc" }, { sort: "asc" }],
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/customers/:id/contacts（创建联系人；isPrimary 时清除其他主联系人） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-contact:create");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-contact.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = contactCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const customer = await prisma.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!customer) return failNotFound(ERROR_CODES.NOT_FOUND, "客户不存在");

  const created = await prisma.$transaction(async (tx) => {
    if (parsed.data.isPrimary) {
      await tx.customerContact.updateMany({
        where: { customerId: id, deletedAt: null },
        data: { isPrimary: false, updatedById: user?.id ?? null },
      });
    }
    return tx.customerContact.create({
      data: { ...parsed.data, customerId: id, createdById: user!.id, updatedById: user!.id },
    });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-contact.create",
    entityType: "customer-contact",
    entityId: created.id,
    meta: { customerId: id, name: created.name },
    ...meta,
  });

  return ok(created, undefined, 201);
}
