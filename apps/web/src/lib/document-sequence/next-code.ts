import { Prisma } from '@prisma/client';
import type { DocumentType } from '@prisma/client';
import { periodKeyOf } from '@/lib/gl/period';

/**
 * 单据序列共享取号引擎（单据序列重构：单据前缀 + LNE + 年份 + 月份 + 4 位，按月重排）
 * - 格式：{prefix}-LNE{YYYY}{MM}{####}（如 SO-LNE2026080001；年份/月份由单据日期按 Asia/Shanghai 归属月自动计算）
 * - 期间行：DocumentSequence.code = `${docType}:${periodKey}`（如 SALES_ORDER:202608），FOR UPDATE 原子取号；
 *   模板行（docType 基准，seed 幂等 upsert）承载 prefix/padLength/periodPattern/perPeriodReset，缺失 fail closed。
 * - 期间行创建用 createMany skipDuplicates（ON CONFLICT DO NOTHING）防并发首张单据竞态——
 *   不能用 create + catch P2002 后同事务重查（PG unique violation 会把事务打进 aborted state，对齐 ledger-command CTO #7667）。
 * - 替换各领域 helpers 中重复的 nextXxxCode 实现（对齐 ADR-0044 编号引擎，backlog B5 全仓单据按月重排）。
 */

/** 期间段模板（新格式：LNE + 年 + 月） */
export const DOCUMENT_SEQUENCE_PERIOD_PATTERN = 'LNE{YYYY}{MM}';
/** 序号位数（新格式 4 位） */
export const DOCUMENT_SEQUENCE_PAD_LENGTH = 4;
/** 占用校验最大尝试次数（防软删记录占唯一键导致的死循环） */
export const DOCUMENT_SEQUENCE_MAX_ATTEMPTS = 100;

export class DocumentSequenceMissingError extends Error {
  constructor(docType: string) {
    super(docType + ' DocumentSequence 缺失（docType=' + docType + '）——部署配置错误，请先执行 seed 初始化');
    this.name = 'DocumentSequenceMissingError';
  }
}

/** 渲染期间段：'LNE{YYYY}{MM}' + date → 'LNE202608'（Asia/Shanghai 归属月，复用 periodKeyOf） */
export function renderPeriodPattern(pattern: string | null | undefined, documentDate: Date): string {
  const periodKey = periodKeyOf(documentDate);
  const year = periodKey.slice(0, 4);
  const month = periodKey.slice(4, 6);
  const p = pattern ?? DOCUMENT_SEQUENCE_PERIOD_PATTERN;
  return p
    .replace(/\{YYYY\}/g, year)
    .replace(/\{YY\}/g, year.slice(2))
    .replace(/\{MM\}/g, month);
}

/** 解析新格式单据号 → { periodKey, seqNo }（单号回收用）；非新格式（历史单号）返回 null */
export function parsePeriodCode(code: string | null | undefined): { periodKey: string; seqNo: number } | null {
  if (!code) return null;
  const m = code.match(/LNE(\d{6})(\d{4})$/);
  if (!m) return null;
  const seqNo = Number(m[2]);
  if (!Number.isFinite(seqNo)) return null;
  return { periodKey: m[1], seqNo };
}

export interface NextDocumentCodeOptions {
  /** 占用校验回调：返回 code 是否可用（未被占用，含软删记录——软删仍占 unique 键）。省略则不做占用校验。 */
  isCodeFree?: (tx: Prisma.TransactionClient, code: string) => Promise<boolean>;
}

/** 原子取号（事务内，FOR UPDATE 原子；期间行不存在则从模板行派生创建） */
export async function nextDocumentCode(
  tx: Prisma.TransactionClient,
  docType: DocumentType,
  documentDate: Date,
  options?: NextDocumentCodeOptions,
): Promise<string> {
  // 1. 模板行（docType 基准，缺失 fail closed——禁 fallback 临时编号）
  const base = await tx.documentSequence.findFirst({
    where: { docType, isActive: true, deletedAt: null },
  });
  if (!base) throw new DocumentSequenceMissingError(docType);

  const prefix = base.prefix ?? '';
  const padLength = base.padLength || DOCUMENT_SEQUENCE_PAD_LENGTH;
  const pattern = base.periodPattern ?? DOCUMENT_SEQUENCE_PERIOD_PATTERN;

  // 2. 期间行（按月重排；code = docType:periodKey）
  const periodKey = periodKeyOf(documentDate);
  const periodCode = docType + ':' + periodKey;
  let seq = await tx.documentSequence.findFirst({ where: { code: periodCode } });
  if (!seq) {
    // 原子创建（冲突无事发生，防并发首张单据期间行竞态；skipDuplicates = ON CONFLICT DO NOTHING）
    await tx.documentSequence.createMany({
      data: [
        {
          code: periodCode,
          name: base.name + '（' + periodKey + '）',
          docType,
          prefix: base.prefix,
          startNo: base.startNo,
          nextNo: base.startNo,
          padLength,
          periodPattern: pattern,
          perPeriodReset: true,
          isActive: true,
          approvalStatus: 'APPROVED',
        },
      ],
      skipDuplicates: true,
    });
    seq = await tx.documentSequence.findFirst({ where: { code: periodCode } });
    if (!seq) throw new DocumentSequenceMissingError(docType);
  }

  // 3. FOR UPDATE 锁行（并发取号串行化）
  await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "DocumentSequence" WHERE "id" = ${seq.id} FOR UPDATE`,
  );

  // 4. 原子递增取号（可选占用校验：软删记录仍占 unique 键，跳过被占用编号）
  const rendered = renderPeriodPattern(pattern, documentDate);
  for (let i = 0; i < DOCUMENT_SEQUENCE_MAX_ATTEMPTS; i += 1) {
    const updated = await tx.documentSequence.update({
      where: { id: seq.id },
      data: { nextNo: { increment: 1 } },
    });
    const code = prefix + '-' + rendered + String(updated.nextNo - 1).padStart(padLength, '0');
    if (!options?.isCodeFree) return code;
    if (await options.isCodeFree(tx, code)) return code;
  }
  throw new Error('DOCUMENT_CODE_EXHAUSTED');
}
