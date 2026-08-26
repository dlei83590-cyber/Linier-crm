/**
 * 单据序列格式预览（客户端纯函数，无服务端依赖）
 * 渲染 periodPattern 为示例编号：{prefix}-{rendered}{pad(1)}，如 SO-LNE2026080001。
 * 与后端 lib/document-sequence/next-code.ts 的 renderPeriodPattern 语义一致（东八区归属月）。
 */

/** 渲染期间段：'LNE{YYYY}{MM}' + periodKey → 'LNE202608' */
export function renderPeriodPatternCst(pattern: string | null | undefined, periodKey: string): string {
  const p = pattern ?? 'LNE{YYYY}{MM}';
  const year = periodKey.slice(0, 4);
  const month = periodKey.slice(4, 6);
  return p
    .replace(/\{YYYY\}/g, year)
    .replace(/\{YY\}/g, year.slice(2))
    .replace(/\{MM\}/g, month);
}

/** 当前 Asia/Shanghai 业务月 'YYYYMM'（东八区归属月，与后端 periodKeyOf 一致） */
export function currentBusinessPeriodKey(): string {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0');
}

/** 示例编号预览：prefix + '-' + 期间段 + 1 位示例序号（padLength 补零） */
export function sequenceFormatPreview(params: {
  prefix: string | null | undefined;
  periodPattern: string | null | undefined;
  padLength: number;
  periodKey?: string;
}): string {
  const prefix = params.prefix ?? '';
  const padLength = params.padLength || 4;
  const periodKey = params.periodKey ?? currentBusinessPeriodKey();
  const rendered = renderPeriodPatternCst(params.periodPattern, periodKey);
  return prefix + '-' + rendered + '1'.padStart(padLength, '0');
}
