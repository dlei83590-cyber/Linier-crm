import type { NextRequest } from 'next/server';
import type { AcceptanceResult } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  authenticate,
  requirePermission,
  requestMeta,
  writeAuditLog,
  assertProjectWritable,
} from '@/lib/api-helpers';
import { ok, failValidation, failConflict, parsePagination } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const acceptanceCreateSchema = z.object({
  name: z.string().min(1).max(200),
  expectedDate: z.string().datetime().nullable().optional(),
  actualDate: z.string().datetime().nullable().optional(),
  result: z.enum(['PASSED', 'CONDITIONAL_PASS', 'FAILED', 'PENDING']).optional(),
  resultNote: z.string().max(1000).nullable().optional(),
});

/** GET /api/projects/:id/acceptance（项目验收项；正常结项需至少一条 PASSED，Sprint 3C-5） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'project-acceptance:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'project-acceptance.list');

  const { id } = await params;
  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, '项目不存在');

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const result = searchParams.get('result')?.trim();

  const where = {
    projectId: id,
    deletedAt: null,
    ...(result ? { result: result as AcceptanceResult } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.projectAcceptance.count({ where }),
    prisma.projectAcceptance.findMany({ where, orderBy: { createdAt: 'asc' }, skip, take }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/projects/:id/acceptance（新增验收项；PASSED 触发 ProjectAccepted） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'project-acceptance:create');
  if (denied) return denied;
  requestLog(request, user?.id, 'project-acceptance.create');

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = acceptanceCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  // L0 lifecycle integrity：mutation 与 Project header lock 同事务（B2-0 锁纪律：Project FOR UPDATE → Gate → mutation）
  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };

    const project = await tx.project.findFirst({ where: { id, deletedAt: null } });
    if (!project) return { error: failConflict(ERROR_CODES.NOT_FOUND, '项目不存在') };

    const created = await tx.projectAcceptance.create({
      data: {
        projectId: id,
        name: parsed.data.name,
        expectedDate: parsed.data.expectedDate ? new Date(parsed.data.expectedDate) : null,
        actualDate: parsed.data.actualDate ? new Date(parsed.data.actualDate) : null,
        result: (parsed.data.result as AcceptanceResult) ?? 'PENDING',
        resultNote: parsed.data.resultNote ?? null,
        approvalStatus: 'APPROVED',
        createdById: user!.id,
        updatedById: user!.id,
      },
    });
    return { created };
  });
  if ('error' in txResult) return txResult.error;
  const created = txResult.created;

  await writeAuditLog({
    actorId: user?.id,
    action: 'project-acceptance.create',
    entityType: 'projectAcceptance',
    entityId: created.id,
    afterData: { projectId: id, name: created.name, result: created.result },
    ...meta,
  });

  // Domain Event：ProjectAccepted（当 result=PASSED）

  return ok(created, undefined, 201);
}
