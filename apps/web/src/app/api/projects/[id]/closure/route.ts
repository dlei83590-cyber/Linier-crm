import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission } from '@/lib/api-helpers';
import { ok, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';

export const dynamic = 'force-dynamic';

/** GET /api/projects/:id/closure（项目结项详情，1:1；结项通过 POST /api/projects/:id/close 执行） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'project-closure:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'project-closure.get');

  const { id } = await params;
  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, '项目不存在');

  const closure = await prisma.projectClosure.findFirst({
    where: { projectId: id, deletedAt: null },
  });
  if (!closure) return failNotFound(ERROR_CODES.NOT_FOUND, '项目尚未结项');
  return ok(closure);
}

/**
 * DELETE /api/projects/:id/closure — 永久禁用（L1-A Closure Contract，CTO 裁决 2026-08-17）。
 * Closure 是一次已发生的 lifecycle fact，不是普通 CRUD 子资源，不可删除。
 * 保留 endpoint 并 fail-closed（避免旧客户端得到 404 后产生歧义）；不保留“非 CLOSED 仍可删” legacy 分支。
 * 如需恢复项目，应使用正式的重新打开流程（Reopen = DESIGN HOLD，当前未实现）。
 */
export async function DELETE(request: NextRequest, _params: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'project-closure:delete');
  if (denied) return denied;
  requestLog(request, user?.id, 'project-closure.delete');

  return failConflict(
    ERROR_CODES.CONFLICT,
    '项目结项记录不可删除；如需恢复项目，应使用正式的重新打开流程',
  );
}
