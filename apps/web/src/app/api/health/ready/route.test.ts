/**
 * /api/health/ready — RBAC 覆盖度诊断（2026-09-27 生产事件回归）
 *
 * 回归点：仅“至少一个角色持有权限关联”无法发现**部分** RBAC 数据陈旧——
 * DB 权限目录缺码或 SUPER_ADMIN 覆盖率不足时，接口表现为部分 403
 * （物料表单的分类 / 供应商下拉 403，其它模块正常），探针必须能直接指出缺哪些码。
 * 同时锁定：覆盖度**不参与** ready 判定（避免把“部分接口不可用”升级为整站被摘除）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ALL_ACTION_PERMISSIONS,
  PERMISSIONS,
  SYSTEM_PERMISSIONS,
  normalizePermissions,
} from '@nilier-crm/shared';

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: {} as Record<string, unknown> }));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

import { GET } from '@/app/api/health/ready/route';

const DECLARED = normalizePermissions([
  ...Object.values(PERMISSIONS),
  ...ALL_ACTION_PERMISSIONS,
  ...SYSTEM_PERMISSIONS,
]);

interface PrismaMock {
  $queryRaw: ReturnType<typeof vi.fn>;
  role: { count: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  permission: { findMany: ReturnType<typeof vi.fn> };
}

function prismaMock(): PrismaMock {
  if (mockPrisma.$queryRaw === undefined) {
    mockPrisma.$queryRaw = vi.fn();
    mockPrisma.role = { count: vi.fn(), findUnique: vi.fn() };
    mockPrisma.permission = { findMany: vi.fn() };
  }
  return mockPrisma as unknown as PrismaMock;
}

/** 数据库/迁移/构建元数据三项均通过，只让 RBAC 覆盖度成为变量 */
function givenHealthyEnvironment(catalogCodes: string[], superAdminCodes: string[]) {
  const p = prismaMock();
  p.$queryRaw = vi.fn((strings: unknown) => {
    const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
    if (sql.includes('_prisma_migrations')) {
      // 取一个字典序大于仓库最新 migration 的名字：迁移基线视为已满足
      return Promise.resolve([{ migration_name: '9999_zzz_latest' }]);
    }
    return Promise.resolve([{ ok: 1 }]);
  });
  p.role.count = vi.fn().mockResolvedValue(5);
  p.permission.findMany = vi.fn().mockResolvedValue(catalogCodes.map((code) => ({ code })));
  p.role.findUnique = vi.fn().mockResolvedValue({ permissions: superAdminCodes.map((code) => ({ code })) });
}

const ENV_KEYS = ['NEXT_PUBLIC_APP_VERSION', 'NEXT_PUBLIC_GIT_SHA', 'NEXT_PUBLIC_BUILD_ID', 'NEXT_PUBLIC_DEPLOYMENT_ENV'] as const;

describe('GET /api/health/ready — RBAC 覆盖度诊断', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_VERSION = '0.0.0-test';
    process.env.NEXT_PUBLIC_GIT_SHA = 'test-sha';
    process.env.NEXT_PUBLIC_BUILD_ID = 'test-build';
    process.env.NEXT_PUBLIC_DEPLOYMENT_ENV = 'test';
  });

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('目录与 SUPER_ADMIN 全覆盖 → ready + 覆盖度 complete', async () => {
    givenHealthyEnvironment(DECLARED, DECLARED);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.rbac.catalogComplete).toBe(true);
    expect(body.rbac.superAdminComplete).toBe(true);
    expect(body.rbac.declaredPermissions).toBe(DECLARED.length);
  });

  it('目录缺码（item-category:view / supplier:view）→ 明确指出缺码 + 给出 seed 提示，但不摘除整站', async () => {
    const catalog = DECLARED.filter((c) => c !== 'item-category:view' && c !== 'supplier:view');
    const superAdmin = catalog.slice(0, 10);
    givenHealthyEnvironment(catalog, superAdmin);
    const res = await GET();
    // 覆盖度只报告、不参与 ready 判定（本端点可能被平台用作运行中容器的健康检查）
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rbacInitialized).toBe(true);
    expect(body.rbac.catalogComplete).toBe(false);
    expect(body.rbac.catalogMissingCount).toBe(2);
    expect(body.rbac.catalogMissingSample).toEqual(expect.arrayContaining(['item-category:view', 'supplier:view']));
    expect(body.rbac.superAdminComplete).toBe(false);
    expect(body.rbac.superAdminMissingCount).toBe(DECLARED.length - 10);
    expect(body.rbac.hint).toContain('pnpm db:seed');
  });

  it('目录完整但 SUPER_ADMIN 覆盖率不足 → 只报角色覆盖缺失（数据陈旧可定位）', async () => {
    givenHealthyEnvironment(DECLARED, DECLARED.filter((c) => c !== 'commercial-term:view'));
    const res = await GET();
    const body = await res.json();
    expect(body.rbac.catalogComplete).toBe(true);
    expect(body.rbac.superAdminComplete).toBe(false);
    expect(body.rbac.superAdminMissingSample).toEqual(['commercial-term:view']);
  });

  it('数据库不可达 → 不冒充覆盖完整（checked=false），且 ready 仍按既有判定返回 unready', async () => {
    const p = prismaMock();
    p.$queryRaw = vi.fn().mockRejectedValue(new Error('connection refused'));
    p.role.count = vi.fn().mockResolvedValue(0);
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.rbac.checked).toBe(false);
    expect(body.rbac.catalogComplete).toBeUndefined();
  });
});
