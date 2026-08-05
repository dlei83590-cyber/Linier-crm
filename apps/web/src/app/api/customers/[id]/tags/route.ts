import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** GET /api/customers/:id/tags（客户标签列表，含标签信息） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-tag:view");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-tag.list");

  const { id } = await params;
  const customer = await prisma.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!customer) return failNotFound(ERROR_CODES.NOT_FOUND, "客户不存在");

  const items = await prisma.customerTag.findMany({
    where: { customerId: id, deletedAt: null },
    include: { tag: { select: { id: true, code: true, name: true, color: true } } },
  });

  return ok(items);
}

/** POST /api/customers/:id/tags（给客户打标签，body: { tagId } 或 { tagCode }） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-tag:create");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-tag.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = z
    .object({
      tagId: z.string().min(1).optional(),
      tagCode: z.string().min(1).optional(),
    })
    .refine((v) => v.tagId || v.tagCode, { message: "tagId 或 tagCode 必填一个" })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const customer = await prisma.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!customer) return failNotFound(ERROR_CODES.NOT_FOUND, "客户不存在");

  const tag = parsed.data.tagId
    ? await prisma.tag.findFirst({ where: { id: parsed.data.tagId, deletedAt: null } })
    : await prisma.tag.findFirst({ where: { code: parsed.data.tagCode, deletedAt: null } });
  if (!tag) return failNotFound(ERROR_CODES.NOT_FOUND, "标签不存在");

  const dup = await prisma.customerTag.findFirst({
    where: { customerId: id, tagId: tag.id, deletedAt: null },
  });
  if (dup) return failConflict(ERROR_CODES.CONFLICT, "客户已拥有该标签");

  const created = await prisma.customerTag.create({
    data: { customerId: id, tagId: tag.id, createdById: user!.id, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-tag.create",
    entityType: "customer-tag",
    entityId: created.id,
    meta: { customerId: id, tagId: tag.id, tagCode: tag.code },
    ...meta,
  });

  return ok(created, undefined, 201);
}
