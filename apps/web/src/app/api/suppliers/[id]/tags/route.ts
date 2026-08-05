import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const tagCreateSchema = z.object({
  tagId: z.string().min(1),
});

/** GET /api/suppliers/:id/tags（标签列表，PartnerTag 共享表） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-tag:view");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-tag.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const supplier = await prisma.supplier.findFirst({ where: { id, deletedAt: null }, select: { partnerId: true } });
  if (!supplier) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");

  const [total, items] = await Promise.all([
    prisma.partnerTag.count({ where: { partnerId: supplier.partnerId, deletedAt: null } }),
    prisma.partnerTag.findMany({
      where: { partnerId: supplier.partnerId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { tag: { select: { id: true, code: true, name: true, color: true } } },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/suppliers/:id/tags（打标签，写入 PartnerTag；重复标签 409） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-tag:create");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-tag.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = tagCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const supplier = await prisma.supplier.findFirst({ where: { id, deletedAt: null }, select: { partnerId: true } });
  if (!supplier) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");

  const tag = await prisma.tag.findFirst({ where: { id: parsed.data.tagId, deletedAt: null } });
  if (!tag) return failConflict(ERROR_CODES.NOT_FOUND, "标签不存在");

  const existing = await prisma.partnerTag.findFirst({
    where: { partnerId: supplier.partnerId, tagId: parsed.data.tagId, deletedAt: null },
  });
  if (existing) return failConflict(ERROR_CODES.CONFLICT, "标签已存在");

  const created = await prisma.partnerTag.create({
    data: { partnerId: supplier.partnerId, tagId: parsed.data.tagId, createdById: user!.id, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "partner-tag.create",
    entityType: "partner-tag",
    entityId: created.id,
    meta: { supplierId: id, partnerId: supplier.partnerId, tagId: parsed.data.tagId },
    ...meta,
  });

  return ok(created, undefined, 201);
}
