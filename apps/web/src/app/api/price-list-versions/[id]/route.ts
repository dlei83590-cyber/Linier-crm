import { NextRequest } from "next/server";
import type { PriceListStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const priceListVersionUpdateSchema = z
  .object({
    revisionNo: z.number().int().positive().optional(),
    status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
    changeSummary: z.string().max(500).nullable().optional(),
    workflowInstanceId: z.string().min(1).nullable().optional(),
    publishedBy: z.string().min(1).nullable().optional(),
    publishedAt: z.string().datetime().nullable().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/price-list-versions/:id（详情含价目表信息） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-list-version:view");
  if (denied) return denied;
  requestLog(request, user?.id, "price-list-version.get");

  const { id } = await params;
  const version = await prisma.priceListVersion.findFirst({
    where: { id, deletedAt: null },
    include: {
      priceList: { select: { id: true, code: true, name: true, currency: true, baseCurrency: true, quoteCurrency: true } },
    },
  });
  if (!version) return failNotFound(ERROR_CODES.NOT_FOUND, "价目表版本不存在");
  return ok(version);
}

/** PATCH /api/price-list-versions/:id（乐观锁 version；PUBLISHED 需已关联 Workflow 审批） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-list-version:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "price-list-version.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = priceListVersionUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.priceListVersion.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "价目表版本不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.priceListVersion.update({
    where: { id },
    data: {
      ...updates,
      status: updates.status as PriceListStatus | undefined,
      publishedAt: updates.publishedAt === undefined ? undefined : updates.publishedAt === null ? null : new Date(updates.publishedAt),
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "price-list-version.update",
    entityType: "priceListVersion",
    entityId: id,
    beforeData: { versionNo: existing.versionNo, status: existing.status },
    afterData: { versionNo: updated.versionNo, status: updated.status },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/price-list-versions/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-list-version:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "price-list-version.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.priceListVersion.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "价目表版本不存在");

  await prisma.priceListVersion.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "price-list-version.delete",
    entityType: "priceListVersion",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
