import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, failConflict } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { reopenPeriod } from '@/lib/gl/period-close';

export const dynamic = 'force-dynamic';

/** POST /api/gl/period-closes/:id/reopen — 期间重开（红字冲销结转凭证 + 删除 GlPeriodClose；ADR-0037；gl:create） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'gl:create');
  if (denied) return denied;
  requestLog(request, user?.id, 'gl.period-close.reopen');

  const { id } = await params;
  const meta = requestMeta(request);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const r = await reopenPeriod(tx, { periodCloseId: id, actorId: user?.id ?? null });
      if (!r.ok) return r;
      await writeAuditLog({
        actorId: user?.id,
        action: 'gl.period-close.reopen',
        entityType: 'gl-period-close',
        entityId: id,
        afterData: { periodKey: r.periodKey, reversalVoucherNo: r.voucherNo },
        ...meta,
      });
      return r;
    });

    if (!result.ok) {
      if (result.code === 'GL_PERIOD_NOT_CLOSED') return failConflict(ERROR_CODES.CONFLICT, '该期间未结转或已重开（无结转记录）');
      if (result.code === 'GL_REOPEN_NO_SOURCE') return failConflict(ERROR_CODES.CONFLICT, '结转凭证无分录，无法冲销');
      if (result.code === 'JOURNAL_SEQUENCE_MISSING') return failConflict(ERROR_CODES.INTERNAL_ERROR, 'JOURNAL 序列缺失（部署配置错误）');
      return failConflict(ERROR_CODES.INTERNAL_ERROR, '重开失败（事务已回滚）');
    }
    return ok(result);
  } catch (err) {
    console.error('[gl.period-close.reopen]', err);
    return failConflict(ERROR_CODES.INTERNAL_ERROR, '重开失败（事务已回滚）');
  }
}
