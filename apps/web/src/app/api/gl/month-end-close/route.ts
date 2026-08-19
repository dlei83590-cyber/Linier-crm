import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { z } from 'zod';
import { closePeriod } from '@/lib/gl/period-close';

export const dynamic = 'force-dynamic';

const closeSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, '期间格式必须为 YYYY-MM'),
});

/** POST /api/gl/month-end-close — 期末结转（收入/费用 → 本年利润；GlPeriodClose 防重复；ADR-0036；gl:create） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'gl:create');
  if (denied) return denied;
  requestLog(request, user?.id, 'gl.month-end-close');

  const parsed = closeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const meta = requestMeta(request);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const r = await closePeriod(tx, { periodKey: parsed.data.period, actorId: user?.id ?? null });
      if (!r.ok) return r;
      await writeAuditLog({
        actorId: user?.id,
        action: 'gl.month-end-close',
        entityType: 'gl-period-close',
        entityId: r.journalEntryId,
        afterData: { periodKey: r.periodKey, voucherNo: r.voucherNo, revenueNet: r.revenueNet, expenseNet: r.expenseNet, profit: r.profit },
        ...meta,
      });
      return r;
    });

    if (!result.ok) {
      if (result.code === 'GL_PERIOD_INVALID') return failValidation({ period: '期间格式必须为 YYYY-MM' });
      if (result.code === 'GL_PERIOD_ALREADY_CLOSED') return failConflict(ERROR_CODES.CONFLICT, '该期间已结转（防重复月结）');
      if (result.code === 'GL_PERIOD_NO_ACTIVITY') return failConflict(ERROR_CODES.CONFLICT, '该期间无收入/费用凭证，无需结转');
      if (result.code === 'JOURNAL_SEQUENCE_MISSING') return fail(ERROR_CODES.INTERNAL_ERROR, 'JOURNAL 序列缺失（部署配置错误）', 500);
      return fail(ERROR_CODES.INTERNAL_ERROR, '结转失败（事务已回滚）', 500);
    }
    return ok(result);
  } catch (err) {
    console.error('[gl.month-end-close]', err);
    return failConflict(ERROR_CODES.INTERNAL_ERROR, '结转失败（事务已回滚）');
  }
}