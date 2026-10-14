import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockPrisma, mockAuthenticate, mockWriteAuditLog } = vi.hoisted(() => ({
  mockPrisma: {} as Record<string, unknown>,
  mockAuthenticate: vi.fn(),
  mockWriteAuditLog: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  authenticate: mockAuthenticate,
  requirePermission: vi.fn().mockReturnValue(null),
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  writeAuditLog: mockWriteAuditLog,
  requestLog: vi.fn(),
}));

import { POST } from '@/app/api/items/route';

/**
 * POST /api/items —「类型」自由文本 → 物料分类（categoryName 解析/新建 + 写入 categoryId）
 * 契约：categoryName 非空时优先于 categoryId；命中即复用绝不重复建；未命中且无 item-category:create → 403；
 * 解析失败整体回滚（不留孤儿分类）；写入 prisma 的 data 不得包含 categoryName（Prisma 不认识该字段）。
 */

type MockFn = ReturnType<typeof vi.fn>;

interface TxMock {
  item: { create: MockFn };
  itemCategory: { findFirst: MockFn; findMany: MockFn; create: MockFn; findUniqueOrThrow: MockFn };
}

interface TxOptions {
  /** 按名称预查已命中的分类 id（null = 未命中） */
  existingCategoryId?: string | null;
  /** 现有 level=1 顶层 categoryPath（用于推导下一个可用路径） */
  usedPaths?: string[];
  /** 新建分类返回的 id */
  createdCategoryId?: string;
}

function sessionUser(permissions: string[]) {
  return {
    id: 'u-1',
    email: 'a@b.c',
    name: null,
    roles: ['SUPER_ADMIN'],
    permissions,
    mustChangePassword: false,
    passwordChangedAt: null,
  };
}

function makeTx(options: TxOptions = {}): TxMock {
  const { existingCategoryId = null, usedPaths = [], createdCategoryId = 'cat-new' } = options;
  const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: createdCategoryId, ...args.data }));
  const tx: TxMock = {
    item: {
      // 回显写入 data，便于断言真正传给 Prisma 的字段
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'item-1', ...args.data })),
    },
    itemCategory: {
      findFirst: vi.fn(async () => (existingCategoryId ? { id: existingCategoryId } : null)),
      findMany: vi.fn(async () => usedPaths.map((categoryPath) => ({ categoryPath }))),
      create,
      // 回显最近一次 create 的 data（模拟同事务内回读 DB 事实）
      findUniqueOrThrow: vi.fn(async () => {
        const lastCreate = create.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> } | undefined;
        return { id: createdCategoryId, ...(lastCreate?.data ?? {}) };
      }),
    },
  };
  return tx;
}

/** $transaction mock：回调抛错 = 真实 Prisma 回滚并重抛（用 onRollback 观测回滚发生） */
function wireTransaction(tx: TxMock, onRollback?: () => void) {
  mockPrisma.$transaction = vi.fn(async (fn: (client: TxMock) => Promise<unknown>) => {
    try {
      return await fn(tx);
    } catch (error) {
      onRollback?.();
      throw error;
    }
  });
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/items', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function itemCreateData(tx: TxMock): Record<string, unknown> {
  const args = tx.item.create.mock.calls[0]?.[0] as { data: Record<string, unknown> } | undefined;
  return args?.data ?? {};
}

describe('POST /api/items —「类型」文字解析/新建物料分类', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue(sessionUser(['item:create', 'item-category:create']));
    mockPrisma.item = { findUnique: vi.fn().mockResolvedValue(null) };
  });

  it('① categoryName 命中已有分类（trim + 大小写不敏感）→ 复用不新建，item 用该 categoryId', async () => {
    const tx = makeTx({ existingCategoryId: 'cat-existing' });
    wireTransaction(tx);

    const res = await POST(makeRequest({ code: 'ITM-001', name: '轴承', categoryName: '  Bearing  ' }));

    expect(res.status).toBe(201);
    const findArgs = tx.itemCategory.findFirst.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(findArgs.where).toMatchObject({
      name: { equals: 'Bearing', mode: 'insensitive' },
      deletedAt: null,
    });
    expect(tx.itemCategory.create).not.toHaveBeenCalled();
    expect(tx.itemCategory.findMany).not.toHaveBeenCalled();
    expect(itemCreateData(tx).categoryId).toBe('cat-existing');
  });

  it('② 未命中且有 item-category:create → 新建分类（MAT-00X / 路径递增 / level=1）并写入 item', async () => {
    const tx = makeTx({ usedPaths: ['001', '007', '001.003'] });
    wireTransaction(tx);

    const res = await POST(makeRequest({ code: 'ITM-002', name: '直线导轨', categoryName: '导轨' }));

    expect(res.status).toBe(201);
    const categoryArgs = tx.itemCategory.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(categoryArgs.data).toMatchObject({
      code: 'MAT-008',
      name: '导轨',
      categoryPath: '008',
      level: 1,
      sort: 0,
      createdById: 'u-1',
      updatedById: 'u-1',
    });
    // 与既有 POST /api/item-categories 一致：不显式设置审批状态（走 DB 默认值）
    expect('approvalStatus' in categoryArgs.data).toBe(false);
    expect(itemCreateData(tx).categoryId).toBe('cat-new');
    // 新建分类必须留痕（与物料自身审计并存）
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'item-category.create',
        entityType: 'item-category',
        entityId: 'cat-new',
        afterData: expect.objectContaining({
          code: 'MAT-008',
          name: '导轨',
          categoryPath: '008',
          level: 1,
          autoCreatedFromItem: true,
        }),
      }),
    );
  });

  it('③ 未命中且无 item-category:create → 403 FORBIDDEN，且不新建分类、不创建物料', async () => {
    mockAuthenticate.mockResolvedValue(sessionUser(['item:create']));
    const tx = makeTx();
    let rolledBack = false;
    wireTransaction(tx, () => {
      rolledBack = true;
    });

    const res = await POST(makeRequest({ code: 'ITM-003', name: '轴承', categoryName: '新类型' }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('item-category:create');
    expect(tx.itemCategory.create).not.toHaveBeenCalled();
    expect(tx.item.create).not.toHaveBeenCalled();
    expect(rolledBack).toBe(true);
  });

  it('④ categoryName 与 categoryId 同时给出 → categoryName 生效', async () => {
    const tx = makeTx({ existingCategoryId: 'cat-by-name' });
    wireTransaction(tx);

    const res = await POST(
      makeRequest({ code: 'ITM-004', name: '轴承', categoryId: 'cat-ignored', categoryName: '轴承' }),
    );

    expect(res.status).toBe(201);
    const findArgs = tx.itemCategory.findFirst.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(findArgs.where.name).toMatchObject({ equals: '轴承' });
    expect(itemCreateData(tx).categoryId).toBe('cat-by-name');
  });

  it('⑤ 传给 prisma.item.create 的 data 不含 categoryName 键（Prisma 不认识该字段）', async () => {
    const tx = makeTx({ existingCategoryId: 'cat-existing' });
    wireTransaction(tx);

    await POST(makeRequest({ code: 'ITM-005', name: '轴承', categoryName: '轴承' }));

    expect('categoryName' in itemCreateData(tx)).toBe(false);
  });

  it('⑥ categoryName 为空/纯空白 → 不解析分类，沿用原 categoryId（既有行为不变）', async () => {
    const tx = makeTx();
    wireTransaction(tx);

    const res = await POST(makeRequest({ code: 'ITM-006', name: '轴承', categoryId: 'cat-keep', categoryName: '   ' }));

    expect(res.status).toBe(201);
    expect(tx.itemCategory.findFirst).not.toHaveBeenCalled();
    expect('categoryName' in itemCreateData(tx)).toBe(false);
    expect(itemCreateData(tx).categoryId).toBe('cat-keep');
  });

  it('⑦ 名称超过 100 字 → 400 VALIDATION_ERROR（中文可读提示）', async () => {
    const tx = makeTx();
    wireTransaction(tx);

    const res = await POST(makeRequest({ code: 'ITM-007', name: '轴承', categoryName: 'X'.repeat(101) }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('物料分类名称不能为空且不超过 100 字');
    expect(tx.itemCategory.create).not.toHaveBeenCalled();
    expect(tx.item.create).not.toHaveBeenCalled();
  });

  it('⑧ 顶层路径已用满（999）→ 409 CONFLICT（PATH_EXHAUSTED），无分类/物料写入', async () => {
    const tx = makeTx({ usedPaths: ['998', '999'] });
    let rolledBack = false;
    wireTransaction(tx, () => {
      rolledBack = true;
    });

    const res = await POST(makeRequest({ code: 'ITM-008', name: '轴承', categoryName: '新类型' }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
    expect(tx.itemCategory.create).not.toHaveBeenCalled();
    expect(tx.item.create).not.toHaveBeenCalled();
    expect(rolledBack).toBe(true);
  });

  it('⑨ 分类创建并发撞车（P2002）→ 不在已 abort 的事务内重试，而是重开事务；第二次成功', async () => {
    // 首次 create 撞唯一约束（并发同名/同路径），事务整体回滚；重开事务后命中已有分类 → 复用
    const tx = makeTx();
    const uniqueViolation = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    tx.itemCategory.create = vi
      .fn()
      .mockRejectedValueOnce(uniqueViolation)
      .mockResolvedValueOnce({ id: 'cat-new' });
    const txSpy = vi.fn(async (fn: (client: TxMock) => Promise<unknown>) => fn(tx));
    mockPrisma.$transaction = txSpy;

    const res = await POST(makeRequest({ code: 'ITM-009', name: '轴承', categoryName: '并发新类型' }));

    expect(res.status).toBe(201);
    // 重开事务（不是在同一事务里续跑——PG 25P02 下那样必然失败）
    expect(txSpy).toHaveBeenCalledTimes(2);
    expect(tx.itemCategory.create).toHaveBeenCalledTimes(2);
    expect(itemCreateData(tx).categoryId).toBe('cat-new');
  });
});
