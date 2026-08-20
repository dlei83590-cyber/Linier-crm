#!/usr/bin/env node
/**
 * Error Codes Catalog Generator / Gate（CTO 仓库巡检审计 P1：ERROR_CODES.md 与 errors.ts 漂移）
 *
 * SSOT = apps/web/src/lib/api/errors.ts（ERROR_CODES 常量）
 * - 默认：重新生成 docs/ERROR_CODES.md（分组表：code | HTTP | 说明；说明优先取行内注释，缺失时按后缀字典派生）
 * - --check：CI Gate——生成内容与已提交文档比对，不一致即 exit 1（防止 errors.ts 增删码后忘记同步文档）
 * 复用 check-rbac-catalog.mjs 的"静态目录一致性 CI Gate"模式（ADR-0028 先例）。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ERRORS_TS = join(ROOT, 'apps', 'web', 'src', 'lib', 'api', 'errors.ts');
const DOC_PATH = join(ROOT, 'docs', 'ERROR_CODES.md');

/** 常见后缀 → 中文说明派生（仅在行内注释缺失时兜底；注释优先） */
const SUFFIX_GLOSS = [
  ['NOT_FOUND', '不存在或已删除'],
  ['INVALID_STATE', '状态不允许该操作'],
  ['ALREADY_APPLIED', '已应用，禁止重复（幂等）'],
  ['ALREADY_POSTED', '已过账，禁止重复（幂等）'],
  ['ALREADY_EXECUTED', '已执行，禁止重复（幂等）'],
  ['ALREADY_CONFIRMED', '已确认，禁止重复'],
  ['ALREADY_RETURNED', '已退货，禁止重复（幂等）'],
  ['ALREADY_RECEIVED', '已收货，禁止重复'],
  ['ALREADY_SUBMITTED', '已提交，禁止重复（幂等）'],
  ['ALREADY_COMPLETED', '已完成，禁止重复'],
  ['ALREADY_REVERSED', '已冲销，禁止重复'],
  ['EXCEEDED', '超出允许范围'],
  ['FORBIDDEN', '无权限或被禁止'],
  ['REQUIRED', '必填/前置条件缺失'],
  ['CODE_EXISTS', '编码已存在'],
  ['WORKFLOW_FAILED', '工作流处理失败'],
  ['APPROVAL_REQUIRED', '审批未完成（需先 APPROVED）'],
  ['APPROVAL_POLICY_NOT_FOUND', '审批策略不存在（配置错误）'],
  ['MAKER_CHECKER', 'maker-checker 校验失败（创建/批准不得同人）'],
  ['SEQUENCE_MISSING', '编号序列缺失（部署配置错误，fail closed）'],
  ['MISMATCH', '不匹配（一致性校验失败）'],
  ['INVALID', '非法值'],
  ['DUPLICATE', '重复（唯一性约束）'],
  ['NO_LINES', '缺少有效行'],
  ['QUANTITY_INVALID', '数量非法'],
  ['NOT_APPROVED', '未审批通过'],
  ['NEGATIVE_BALANCE', '负余额（Customer Credit 门禁）'],
  ['UNSUPPORTED', '不支持的操作'],
];

function deriveGloss(code) {
  for (const [suffix, gloss] of SUFFIX_GLOSS) {
    if (code.endsWith(suffix)) return gloss;
  }
  return code;
}

/** 解析 errors.ts → [{ section, code, note, http }] */
function parseErrors(source) {
  const lines = source.split(/\r?\n/);
  const entries = [];
  let section = '通用（COMMON）';
  let pendingKey = null; // 多行条目（KEY: 换行 'VALUE',）
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    // 分组注释（// ...）——跳过文件头注释
    if (/^\/\//.test(trimmed) && !trimmed.startsWith('// *')) {
      const m = trimmed.match(/^\/\/\s*(.+)$/);
      if (m) {
        const text = m[1].trim();
        if (!/^Sprint 3A - 统一 API 错误码常量|所有平台 API 必须/.test(text)) {
          section = text.replace(/：.*$/, '').trim() || '通用';
        }
      }
      continue;
    }
    const entryMatch = trimmed.match(/^([A-Z0-9_]+):\s*'([A-Z0-9_]+)',?\s*(?:\/\/\s*(.*))?$/);
    if (entryMatch) {
      const [, key, value, noteRaw] = entryMatch;
      const note = (noteRaw ?? '').trim().replace(/，$/g, '');
      const httpMatch = note.match(/(\d{3})/);
      entries.push({ section, code: key, value, note: note || '', http: httpMatch ? httpMatch[1] : '-' });
      pendingKey = null;
      continue;
    }
    // 多行条目续行：'VALUE', // note
    const contMatch = trimmed.match(/^'([A-Z0-9_]+)',?\s*(?:\/\/\s*(.*))?$/);
    if (contMatch && pendingKey) {
      const note = (contMatch[2] ?? '').trim().replace(/，$/g, '');
      const last = entries[entries.length - 1];
      if (last && last.code === pendingKey) {
        const httpMatch = note.match(/(\d{3})/);
        last.note = note || last.note;
        last.http = httpMatch ? httpMatch[1] : last.http;
      }
      pendingKey = null;
      continue;
    }
    // 记录可能是多行条目的 KEY:
    const keyLine = trimmed.match(/^([A-Z0-9_]+):\s*$/);
    if (keyLine) pendingKey = keyLine[1];
  }
  return entries;
}

function buildDoc(entries, total) {
  const out = [];
  out.push('# ERROR_CODES 错误码注册表');
  out.push('');
  out.push('> **本文件由 `scripts/gen-error-codes.mjs` 自动生成（SSOT = `apps/web/src/lib/api/errors.ts`），禁止手工编辑。**');
  out.push('> 修改错误码后运行 `node scripts/gen-error-codes.mjs` 重新生成；CI Gate 校验文档与代码同步。');
  out.push('');
  out.push('| code | HTTP | 说明 |');
  out.push('| --- | --- | --- |');
  for (const e of entries) {
    const gloss = e.note || deriveGloss(e.code);
    out.push(`| ${e.code} | ${e.http} | ${gloss.replace(/\|/g, '｜')} |`);
  }
  out.push('');
  out.push(`> 合计：**${total} 个错误码**（自动统计）`);
  out.push('');
  return out.join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const src = readFileSync(ERRORS_TS, 'utf8');
  const entries = parseErrors(src);
  const total = entries.length;
  if (total === 0) {
    console.error('[gen-error-codes] 未解析到任何错误码——errors.ts 结构可能已变化，请检查脚本');
    process.exit(1);
  }
  const doc = buildDoc(entries, total);
  if (check) {
    const existing = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, 'utf8') : '';
    if (existing.trim() === doc.trim()) {
      console.log(`[gen-error-codes] OK：ERROR_CODES.md 与 errors.ts 同步（${total} 个码）`);
      process.exit(0);
    }
    console.error(`[gen-error-codes] FAIL：docs/ERROR_CODES.md 与 errors.ts 不同步（${total} 个码）——请运行 node scripts/gen-error-codes.mjs 重新生成并提交`);
    process.exit(1);
  }
  writeFileSync(DOC_PATH, doc, 'utf8');
  console.log(`[gen-error-codes] 已生成 docs/ERROR_CODES.md（${total} 个码）`);
}

main();
