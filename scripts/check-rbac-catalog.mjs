/**
 * ADR-0028 CI 静态 Gate — API referenced permission ⊆ ALL_ACTION_PERMISSIONS
 *
 * 扫描：
 *  1) apps/web/src/app/api 全部 route 中所有 requirePermission(actor, "module:action") 引用的权限码
 *  2) prisma/seed.ts SEED_ACTION_MODULES 模块
 *  3) packages/shared/src/constants/index.ts PERMISSION_MODULES（生成 ALL_ACTION_PERMISSIONS）与 SYSTEM_PERMISSIONS
 * 校验：
 *  - 每个引用的 module:action 的 module ∈ PERMISSION_MODULES，或完整码 ∈ SYSTEM_PERMISSIONS
 *  - SEED_ACTION_MODULES ⊆ PERMISSION_MODULES（static RBAC 与 DB permission catalog 不漂移）
 * 违规 → 非零退出（CI fail）。
 * 用法：node scripts/check-rbac-catalog.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const issues = [];

/** 提取 `const NAME = [ ... ] as const;` 中的字符串元素 */
function extractStringArray(text, declName) {
  const re = new RegExp(`${declName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`, 'm');
  const m = text.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

// 1) shared constants
const constantsText = readFileSync(join(root, 'packages/shared/src/constants/index.ts'), 'utf8');
const permissionModules = new Set(extractStringArray(constantsText, 'PERMISSION_MODULES'));
const systemPermissions = new Set(extractStringArray(constantsText, 'SYSTEM_PERMISSIONS'));

// 2) seed SEED_ACTION_MODULES
const seedText = readFileSync(join(root, 'prisma/seed.ts'), 'utf8');
const seedModules = new Set(extractStringArray(seedText, 'SEED_ACTION_MODULES'));

// 3) API requirePermission 引用
const apiDir = join(root, 'apps/web/src/app/api');
const apiFiles = walk(apiDir);
const referenced = [];
const permRe = /requirePermission\([^)]*?['"]([^'"]+)['"]/g;
for (const f of apiFiles) {
  const text = readFileSync(f, 'utf8');
  let m;
  while ((m = permRe.exec(text)) !== null) {
    referenced.push({ code: m[1], file: f.replace(root + '/', '') });
  }
}

// 校验 1：API referenced permission ⊆ ALL_ACTION_PERMISSIONS ∪ SYSTEM_PERMISSIONS
for (const { code, file } of referenced) {
  if (systemPermissions.has(code)) continue;
  const idx = code.indexOf(':');
  const module = idx > 0 ? code.slice(0, idx) : code;
  if (!permissionModules.has(module)) {
    issues.push(`API referenced permission "${code}" (${file})：module "${module}" 不在 PERMISSION_MODULES（ADR-0028：API referenced permission ⊆ ALL_ACTION_PERMISSIONS）`);
  }
}

// 校验 2：SEED_ACTION_MODULES ⊆ PERMISSION_MODULES
for (const module of seedModules) {
  if (!permissionModules.has(module)) {
    issues.push(`seed SEED_ACTION_MODULES module "${module}" 不在 shared PERMISSION_MODULES（static RBAC 与 DB catalog 漂移）`);
  }
}

if (issues.length > 0) {
  console.error(`[check-rbac-catalog] FAIL: ${issues.length} 处违规（ADR-0028）`);
  for (const i of issues) console.error(' - ' + i);
  process.exit(1);
}

console.log(`[check-rbac-catalog] OK：${referenced.length} 个 requirePermission 引用 + ${seedModules.size} 个 seed 模块全部 ∈ PERMISSION_MODULES / SYSTEM_PERMISSIONS（ADR-0028）`);