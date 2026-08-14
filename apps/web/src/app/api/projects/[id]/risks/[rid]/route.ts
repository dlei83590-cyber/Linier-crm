import { NextRequest } from "next/server";
import type { RiskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const riskUpdateSchema = z
  .object({
    description: z.string().min(1).max(1000).optional(),
    impact: z.string().max(500).nullable().optional(),
    probability: z.enum(["HIGH", "MEDIUM", "LOW"]).nullable().optional(),
    mitigation: z.string().max(1000).nullable().optional(),
    ownerId: z.string().min(1).nullable().optional(),
    status: z.enum(["OPEN", "MITIGATING", "CLOSED"]).optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/projects/:id/risks/:rid（风险详情） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-risk:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-risk.get");

  const { id, rid } = await params;
  const item = await prisma.projectRisk.findFirst({ where: { id: rid, projectId: id, deletedAt: null } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "风险不存在");
  return ok(item);
}

/** PATCH /api/projects/:id/risks/:rid（乐观锁 version；关闭时写 closedAt + 触发 ProjectRiskClosed） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-risk:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "project-risk.update");

  const { id, rid } = await params;
  const meta = requestMeta(request);
  const writableErr = await assertProjectWritable(id);
  if (writableErr) return writableErr;
  const parsed = riskUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.projectRisk.findFirst({ where: { id: rid, projectId: id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "风险不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.projectRisk.update({
    where: { id: rid },
    data: {
      ...updates,
      status: updates.status as RiskStatus | undefined,
      closedAt: updates.status === "CLOSED" ? new Date() : updates.status === "OPEN" ? null : undefined,
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-risk.update",
    entityType: "projectRisk",
    entityId: rid,
    beforeData: { description: existing.description, status: existing.status },
    afterData: { description: updated.description, status: updated.status, closedAt: updated.closedAt },
    ...meta,
  });

  // Domain Event：ProjectRiskClosed（当更新后 status=CLOSED）

  return ok(updated);
}

/** DELETE /api/projects/:id/risks/:rid（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-risk:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "project-risk.delete");

  const { id, rid } = await params;
  const meta = requestMeta(request);
  const writableErr = await assertProjectWritable(id);
  if (writableErr) return writableErr;

  const existing = await prisma.projectRisk.findFirst({ where: { id: rid, projectId: id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "风险不存在");

  await prisma.projectRisk.update({
    where: { id: rid },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-risk.delete",
    entityType: "projectRisk",
    entityId: rid,
    ...meta,
  });

  return ok({ id: rid, deleted: true });
}
