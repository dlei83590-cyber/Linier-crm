import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, failValidation, failConflict } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { z } from 'zod';
import { validateGlLines } from '@/lib/gl/entry-helpers';

export const dynamic = 'force-dynamic';

const manualCreateSchema = z.object({
  postingDate: z.string().min(1),
  summary: z.string().max(500).optional(),
  lines: z
    .array(
      z.object({
        accountCode: z.string().min(1),
        debit: z.string().regex(/^\d+(\.\d+)?$/, '金额格式错误').optional(),
        credit: z.string().regex(/^\d+(\.\d+)?$/, '金额格式错误').optional(),
        summary: z.string().max(200).optional(),
      }),
    )
    .min(2),
});

/**
 * POST /api/gl/journal-entries/manual — 手工凭证创建（DRAFT；借贷平衡校验；DRAFT 不占号——4D 教训，ADR-0035）
 * 权限 gl:create（会计敏感仅 SUPER_ADMIN/ADMIN）。maker-checker 在 approve/post 动作强制。
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'gl:create');
  if (denied) return denied;
  requestLog(request, user?.id, 'gl.journal-entry.manual.create');

  const parsed = manualCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const meta = requestMeta(request);

  try {
    const entry = await prisma.$transaction(async (tx) => {
      // 借贷平衡 + 科目校验（复用核心，fail closed）
      const linesData = await validateGlLines(tx, parsed.data.lines);
      const sourceId = crypto.randomUUID();
      const created = await tx.glJournalEntry.create({
        data: {
          voucherNo: null, // DRAFT 不占号
          postingDate: new Date(parsed.data.postingDate),
          status: 'DRAFT',
          sourceType: 'MANUAL',
          sourceId,
          summary: parsed.data.summary,
          createdById: user?.id ?? null,
          lines: { create: linesData },
        },
        include: { lines: true },
      });
      await writeAuditLog({
        actorId: user?.id,
        action: 'gl.journal-entry.manual.create',
        entityType: 'gl-journal-entry',
        entityId: created.id,
        afterData: { status: 'DRAFT', summary: parsed.data.summary, lineCount: linesData.length },
        ...meta,
      });
      return created;
    });
    return ok(entry, undefined, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.startsWith('GL_ACCOUNT_MISSING')) {
      return failValidation({ lines: '存在未注册科目（fail closed）：' + msg.split(':')[1] });
    }
    if (msg === 'GL_UNBALANCED') return failConflict(ERROR_CODES.CONFLICT, '借贷不平衡（Σ借方 ≠ Σ贷方），拒绝创建');
    if (msg === 'GL_BOTH_SIDES') return failValidation({ lines: '每行只能填写借方或贷方一侧' });
    if (msg === 'GL_ZERO_AMOUNT') return failValidation({ lines: '每行金额必须大于 0' });
    console.error('[gl.journal-entry.manual.create]', err);
    return failConflict(ERROR_CODES.INTERNAL_ERROR, '创建失败（事务已回滚）');
  }
}