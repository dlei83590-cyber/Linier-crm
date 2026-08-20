#!/usr/bin/env node
/**
 * A-2 codemod：简单 PATCH 路由 read-check-update → 原子 CAS（casUpdate）
 * 仅处理「直接 prisma.<model>.update + existing.version 前置检查 + 无 $transaction」的简单模式；
 * 其余跳过（A-3 手工/后续）。用法：node scripts/codemod-cas.mjs [--apply]（默认 dry-run）
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const API_DIR = join(ROOT, 'apps', 'web', 'src', 'app', 'api');

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (e === 'route.ts') out.push(p);
  }
  return out;
}

const apply = process.argv.includes('--apply');
const files = walk(API_DIR).filter((f) => {
  const s = readFileSync(f, 'utf8');
  return s.includes('version: { increment: 1 }') && !s.includes('casUpdate');
});

let transformed = 0;
const skipped = [];

for (const f of files) {
  let s = readFileSync(f, 'utf8');
  const skip = (why) => { skipped.push(f.replace(ROOT, '') + ' (' + why + ')'); };
  // 条件：前置检查 + 直接 prisma.<model>.update + 无 $transaction
  if (s.indexOf('if (existing.version !== version) {') === -1) { skip('no-precheck'); continue; }
  if (s.indexOf('$transaction') !== -1) { skip('transaction'); continue; }
  const marker = 'const updated = await prisma.';
  const mIdx = s.indexOf(marker);
  if (mIdx === -1) { skip('no-simple-update'); continue; }
  const modelStart = mIdx + marker.length;
  const updIdx = s.indexOf('.update({', modelStart);
  if (updIdx === -1) { skip('no-update-call'); continue; }
  const model = s.slice(modelStart, updIdx);
  if (!/^[A-Za-z]+$/.test(model)) { skip('bad-model:' + model); continue; }
  // NOT_FOUND code/msg
  let nfCode = 'ERROR_CODES.NOT_FOUND';
  let nfMsg = '资源不存在';
  const nfIdx = s.indexOf('if (!existing) return failNotFound(');
  if (nfIdx !== -1) {
    const cs = nfIdx + 'if (!existing) return failNotFound('.length;
    const ce = s.indexOf(',', cs);
    if (ce !== -1) {
      nfCode = s.slice(cs, ce).trim();
      const ms = s.indexOf('"', ce);
      const me = s.indexOf('"', ms + 1);
      if (ms !== -1 && me !== -1) nfMsg = s.slice(ms + 1, me);
    }
  }
  // 1) 移除 version 前置检查块（找到 { 到匹配 }）
  const chkIdx = s.indexOf('if (existing.version !== version) {');
  let depth = 1, i = chkIdx + 'if (existing.version !== version) {'.length;
  while (depth > 0 && i < s.length) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') depth--;
    i++;
  }
  s = s.slice(0, chkIdx) + s.slice(i);
  // 2) 提取 data 对象并替换 update 调用
  const mIdx2 = s.indexOf(marker);
  const updIdx2 = s.indexOf('.update({', mIdx2 + marker.length);
  const dataIdx = s.indexOf('data: {', updIdx2);
  depth = 1; i = dataIdx + 'data: {'.length;
  while (depth > 0 && i < s.length) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') depth--;
    i++;
  }
  const dataObj = s.slice(dataIdx + 'data: {'.length, i - 1);
  const dataClean = dataObj.replace(/\n\s*version: \{ increment: 1 \},?/, '');
  const endIdx = s.indexOf('});', updIdx2);
  if (endIdx === -1) { skip('no-update-end'); continue; }
  const before = s.slice(0, mIdx2);
  const after = s.slice(endIdx + 3);
  const replacement =
    "const cas = await casUpdate(prisma, '" + model + "', id, version, {" + dataClean + "\n});" +
    "\n  if (cas.outcome === 'NOT_FOUND') return failNotFound(" + nfCode + ", \"" + nfMsg + "\");" +
    "\n  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, \"版本冲突，请刷新后重试\");" +
    "\n  const updated = await prisma." + model + ".findFirst({ where: { id, deletedAt: null } });" +
    "\n  if (!updated) return failNotFound(" + nfCode + ", \"" + nfMsg + "\");";
  s = before + replacement + after;
  // 3) import
  if (s.indexOf('import { casUpdate }') === -1) {
    const impIdx = s.indexOf('import { requestLog }');
    const impEnd = s.indexOf('\n', impIdx);
    s = s.slice(0, impEnd + 1) + 'import { casUpdate } from "@/lib/api/cas";\n' + s.slice(impEnd + 1);
  }
  if (apply) writeFileSync(f, s, 'utf8');
  transformed++;
  console.log((apply ? '[APPLIED] ' : '[DRY] ') + f.replace(ROOT, ''));
}

console.log('=== RESULT ===');
console.log('candidates: ' + files.length + ' | transformed: ' + transformed + ' | skipped: ' + skipped.length);
for (const x of skipped.slice(0, 60)) console.log('  skip: ' + x);
