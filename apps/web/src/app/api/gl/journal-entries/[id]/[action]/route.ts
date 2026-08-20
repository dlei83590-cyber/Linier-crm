import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, failNotFound, failValidation, failConflict } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { assertGlLinesBalanced } from '@/lib/gl/entry-helpers';
import { assertPeriodOpen, periodKeyOf } from '@/lib/gl/period';
import { nextVoucherNo } from '@/lib/gl/voucher-number';

export const dynamic = 'force-dynamic';

const actionSchema = z.object({ version: z.number().int().positive() });

const TRANSITIONS: Record<string, { from: string[]; to: string; permission: string; audit: string; makerCheck: boolean }> = {
  submit: { from: ['DRAFT'], to: 'SUBMITTED', permission: 'gl:edit', audit: 'gl.journal-entry.submit', makerCheck: false },
  approve: { from: ['SUBMITTED'], to: 'APPROVED', permission: 'gl:approve', audit: 'gl.journal-entry.approve', makerCheck: true },
  reject: { from: ['SUBMITTED'], to: 'REJECTED', permission: 'gl:approve', audit: 'gl.journal-entry.reject', makerCheck: true },
  post: { from: ['APPROVED'], to: 'POSTED', permission: 'gl:create', audit: 'gl.journal-entry.post', makerCheck: true },
};

// 取号已迁移至 lib/gl/voucher-number.ts（ADR-0044：按 (期间, 凭证字) 连续编号）

/**
 * POST /api/gl/journal-entries/:id/:action — 手工凭证状态动作（submit/approve/reject/post；ADR-0035）
 * maker-checker：approve/reject（审核人 ≠ 创建人）、post（过账人 ≠ 创建人）业务层强制。
 * post 时取号（DRAFT 不占号——4D 教训）；POSTED 终态不可变。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  const user = await authenticate(request);
  const { id, action } = await params;
  const tpl = TRANSITIONS[action];
  if (!tpl) return failNotFound(ERROR_CODES.NOT_FOUND, '未知状态动作：' + action);

  const denied = requirePermission(user, tpl.permission);
  if (denied) return denied;
  requestLog(request, user?.id, tpl.audit);

  const meta = requestMeta(request);
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.glJournalEntry.findFirst({
        where: { id, deletedAt: null },
        include: { lines: { select: { debit: true, credit: true } } },
      });
      if (!existing) throw new Error('NOT_FOUND');
      if (existing.sourceType !== 'MANUAL') throw new Error('NOT_MANUAL');
      if (!tpl.from.includes(existing.status)) throw new Error('INVALID_STATE');
      if (existing.version !== parsed.data.version) throw new Error('VERSION_CONFLICT');
      if (tpl.makerCheck && existing.createdById === user?.id) throw new Error('MAKER_CHECKER');

      const data: Record<string, unknown> = { version: { increment: 1 } };
      if (action === 'approve') {
        data.approvedById = user?.id ?? null;
        data.approvedAt = new Date();
      } else if (action === 'post') {
        // 借贷平衡最终复核 + 期间校验（fail closed，ADR-0044）+ 取号（事务内）
        assertGlLinesBalanced(existing.lines);
        await assertPeriodOpen(tx, existing.postingDate, existing.sourceType);
        data.voucherNo = await nextVoucherNo(tx, {
          periodKey: periodKeyOf(existing.postingDate),
          voucherType: existing.voucherType,
        });
        data.postedById = user?.id ?? null;
        data.postedAt = new Date();
      }
      data.status = tpl.to;

      const updated = await tx.glJournalEntry.update({ where: { id }, data });
      await writeAuditLog({
        actorId: user?.id,
        action: tpl.audit,
        entityType: 'gl-journal-entry',
        entityId: id,
        beforeData: { status: existing.status },
        afterData: { status: tpl.to, ...(action === 'post' ? { voucherNo: updated.voucherNo } : {}) },
        ...meta,
      });
      return updated;
    });
    return ok(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, '记账凭证不存在');
    if (msg === 'NOT_MANUAL') return failConflict(ERROR_CODES.CONFLICT, '仅手工凭证可流转（自动过账凭证终态）');
    if (msg === 'INVALID_STATE') return failConflict(ERROR_CODES.CONFLICT, '状态不允许该动作（当前非预期状态）');
    if (msg === 'VERSION_CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
    if (msg === 'MAKER_CHECKER') return failConflict(ERROR_CODES.CONFLICT, '审核/过账人不能是创建人（maker-checker）');
    if (msg === 'GL_UNBALANCED') return failConflict(ERROR_CODES.CONFLICT, '借贷不平衡，拒绝过账');
    if (msg === 'JOURNAL_SEQUENCE_MISSING') return failConflict(ERROR_CODES.INTERNAL_ERROR, 'JOURNAL 序列缺失（部署配置错误）');
    if (msg === 'GL_PERIOD_CLOSED') return failConflict(ERROR_CODES.GL_PERIOD_CLOSED, '该期间已结转（CLOSED），禁止过账');
    if (msg === 'GL_PERIOD_LOCKED') return failConflict(ERROR_CODES.GL_PERIOD_LOCKED, '该期间已锁定（LOCKED），禁止过账');
    if (msg === 'GL_PERIOD_FUTURE') return failConflict(ERROR_CODES.GL_PERIOD_FUTURE, '禁止未来期间过账');
    if (msg === 'GL_PERIOD_NOT_FOUND') return failConflict(ERROR_CODES.GL_PERIOD_NOT_FOUND, '会计期间不存在——请先运行期间 backfill 初始化');
    console.error('[gl.journal-entry.' + action + ']', err);
    return failConflict(ERROR_CODES.INTERNAL_ERROR, '操作失败（事务已回滚）');
  }
}