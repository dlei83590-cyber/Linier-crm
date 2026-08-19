import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, failNotFound, failValidation, failConflict } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { z } from 'zod';
import { validateGlLines } from '@/lib/gl/entry-helpers';

export const dynamic = 'force-dynamic';

/** GET /api/gl/journal-entries/:id — 记账凭证详情（含行 + 科目；Sprint 7 GL，ADR-0033；gl:view） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'gl:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'gl.journal-entry.get');

  const { id } = await params;
  const entry = await prisma.glJournalEntry.findFirst({
    where: { id, deletedAt: null },
    include: {
      lines: {
        include: { account: { select: { id: true, code: true, name: true, category: true, direction: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!entry) return failNotFound(ERROR_CODES.NOT_FOUND, '记账凭证不存在');
  return ok(entry);
}
const manualPatchSchema = z.object({
  postingDate: z.string().min(1).optional(),
  summary: z.string().max(500).nullable().optional(),
  lines: z
    .array(
      z.object({
        accountCode: z.string().min(1),
        debit: z.string().regex(/^\d+(\.\d+)?$/, '金额格式错误').optional(),
        credit: z.string().regex(/^\d+(\.\d+)?$/, '金额格式错误').optional(),
        summary: z.string().max(200).optional(),
      }),
    )
    .min(2)
    .optional(),
  version: z.number().int().positive(),
});

/**
 * PATCH /api/gl/journal-entries/:id — 手工凭证编辑（DRAFT or REJECTED only；version CAS；行整体替换；ADR-0035）
 * 权限 gl:edit。自动过账凭证（POSTED）禁止编辑。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'gl:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'gl.journal-entry.update');

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = manualPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.glJournalEntry.findFirst({ where: { id, deletedAt: null }, select: { status: true, version: true, sourceType: true } });
      if (!existing) throw new Error('NOT_FOUND');
      if (existing.sourceType !== 'MANUAL') throw new Error('NOT_MANUAL');
      if (existing.status !== 'DRAFT' && existing.status !== 'REJECTED') throw new Error('INVALID_STATE');
      if (existing.version !== parsed.data.version) throw new Error('VERSION_CONFLICT');

      let linesData;
      if (parsed.data.lines) {
        linesData = await validateGlLines(tx, parsed.data.lines);
      }

      const result = await tx.glJournalEntry.update({
        where: { id },
        data: {
          ...(parsed.data.postingDate ? { postingDate: new Date(parsed.data.postingDate) } : {}),
          ...(parsed.data.summary !== undefined ? { summary: parsed.data.summary } : {}),
          ...(linesData ? { lines: { deleteMany: {}, create: linesData } } : {}),
          version: { increment: 1 },
        },
        include: { lines: true },
      });
      await writeAuditLog({
        actorId: user?.id,
        action: 'gl.journal-entry.update',
        entityType: 'gl-journal-entry',
        entityId: id,
        beforeData: { version: existing.version },
        afterData: { version: result.version, lineCount: result.lines.length },
        ...meta,
      });
      return result;
    });
    return ok(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, '记账凭证不存在');
    if (msg === 'NOT_MANUAL') return failConflict(ERROR_CODES.CONFLICT, '仅手工凭证可编辑（自动过账凭证不可变）');
    if (msg === 'INVALID_STATE') return failConflict(ERROR_CODES.CONFLICT, '仅 DRAFT/REJECTED 状态可编辑');
    if (msg === 'VERSION_CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
    if (msg === 'GL_UNBALANCED') return failConflict(ERROR_CODES.CONFLICT, '借贷不平衡（Σ借方 ≠ Σ贷方），拒绝保存');
    if (msg.startsWith('GL_ACCOUNT_MISSING')) return failValidation({ lines: '存在未注册科目：' + msg.split(':')[1] });
    if (msg === 'GL_BOTH_SIDES') return failValidation({ lines: '每行只能填写借方或贷方一侧' });
    console.error('[gl.journal-entry.update]', err);
    return failConflict(ERROR_CODES.INTERNAL_ERROR, '更新失败（事务已回滚）');
  }
}
