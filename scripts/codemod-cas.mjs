#!/usr/bin/env node
/**
 * A-3 codemod v2：简单 PATCH 路由 read-check-update → 原子 CAS（casUpdate）
 * 修复 v1 问题：① 子资源变量名（where 中非 id 者）② version 行行级剥离 ③ 输出统一 LF
 * 仅处理「直接 prisma.<model>.update + existing.version 前置检查 + 无 $transaction」；
 * 用法：node scripts/codemod-cas.mjs [--apply] [--only=路径子串]（默认 dry-run）
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
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length) : null;
const files = walk(API_DIR).filter((f) => {
  if (only && !f.includes(only)) return false;
  const s = readFileSync(f, 'utf8');
  return s.includes('version: { increment: 1 }') && !s.includes('casUpdate');
});

let transformed = 0;
const skipped = [];

for (const f of files) {
  let s = readFileSync(f, 'utf8');
  const skip = (why) => { skipped.push(f.replace(ROOT, '') + ' (' + why + ')'); };
  if (s.indexOf('if (existing.version !== version) {') === -1) { skip('no-precheck'); continue; }
  if (s.indexOf('$transaction') !== -1) { skip('transaction'); continue; }
  const marker = 'const updated = await prisma.';
  const mIdx = s.indexOf(marker);
  if (mIdx === -1) { skip('no-simple-update'); continue; }
  const modelStart = mIdx + marker.length;
  const updIdx = s.indexOf('.update({', modelStart);
  if (updIdx === -1) { skip('no-update-call'); continue; }
  const model = s.slice(modelStart, updIdx);
  if (!/^[A-Za-z]+$/.test(model)) { skip('bad-model'); continue; }
  const whereIdx = s.indexOf('where: {', updIdx);
  const whereEnd = s.indexOf('}', whereIdx);
  const whereClause = s.slice(whereIdx + 'where: {'.length, whereEnd).trim();
  // 支持 `id: <var>`（嵌套路由）与直接 `<var>` 两种 where 形式
  const idMap = whereClause.match(/^id:\s*([A-Za-z_]+)/);
  const varName = idMap ? idMap[1] : whereClause.split(',')[0].trim();
  if (!/^[A-Za-z_]+$/.test(varName)) { skip('bad-where-var:' + whereClause); continue; }
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
  const chkIdx = s.indexOf('if (existing.version !== version) {');
  let depth = 1, i = chkIdx + 'if (existing.version !== version) {'.length;
  while (depth > 0 && i < s.length) { if (s[i] === '{') depth++; else if (s[i] === '}') depth--; i++; }
  s = s.slice(0, chkIdx) + s.slice(i);
  const mIdx2 = s.indexOf(marker);
  const updIdx2 = s.indexOf('.update({', mIdx2 + marker.length);
  const dataIdx = s.indexOf('data: {', updIdx2);
  depth = 1; i = dataIdx + 'data: {'.length;
  while (depth > 0 && i < s.length) { if (s[i] === '{') depth++; else if (s[i] === '}') depth--; i++; }
  const dataObj = s.slice(dataIdx + 'data: {'.length, i - 1);
  const dataClean = dataObj
    .replace(/,\s*version: \{ increment: 1 \}/, '')
    .replace(/version: \{ increment: 1 \},\s*/, '')
    .trim();
  const endIdx = s.indexOf('});', updIdx2);
  if (endIdx === -1) { skip('no-update-end'); continue; }
  const before = s.slice(0, mIdx2);
  const after = s.slice(endIdx + 3);
  const replacement =
    "const cas = await casUpdate(prisma, '" + model + "', " + varName + ", version, {" + dataClean + "\n});" +
    "\n  if (cas.outcome === 'NOT_FOUND') return failNotFound(" + nfCode + ", \"" + nfMsg + "\");" +
    "\n  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, \"版本冲突，请刷新后重试\");" +
    "\n  const updated = await prisma." + model + ".findFirst({ where: { id: " + varName + ", deletedAt: null } });" +
    "\n  if (!updated) return failNotFound(" + nfCode + ", \"" + nfMsg + "\");";
  s = before + replacement + after;
  if (s.indexOf('import { casUpdate }') === -1) {
    const impIdx = s.indexOf('import { requestLog }');
    const impEnd = s.indexOf('\n', impIdx);
    s = s.slice(0, impEnd + 1) + 'import { casUpdate } from "@/lib/api/cas";\n' + s.slice(impEnd + 1);
  }
  s = s.replace(/\r\n/g, '\n');
  if (apply) writeFileSync(f, s, 'utf8');
  transformed++;
  console.log((apply ? '[APPLIED] ' : '[DRY] ') + f.replace(ROOT, ''));
}

console.log('=== RESULT ===');
console.log('candidates: ' + files.length + ' | transformed: ' + transformed + ' | skipped: ' + skipped.length);
for (const x of skipped.slice(0, 30)) console.log('  skip: ' + x);
