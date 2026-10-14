import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: {} as Record<string, unknown> }));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/api-helpers', () => ({
  // ADR-0057：权限判定消费会话 permissions（PATCH 的「类型→分类」解析需要 item-category:create）
  authenticate: vi.fn().mockResolvedValue({
    id: 'u-1',
    email: 'a@b.c',
    name: null,
    roles: ['SUPER_ADMIN'],
    permissions: ['item:view', 'item:create', 'item:edit', 'item:delete', 'item-category:create'],
    mustChangePassword: false,
    passwordChangedAt: null,
  }),
  requirePermission: vi.fn().mockReturnValue(null),
  requestMeta: vi.fn().mockReturnValue({ requestId: 'req-1' }),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  requestLog: vi.fn(),
}));
vi.mock('@/lib/api/cas', () => ({ casUpdate: vi.fn() }));

import { DELETE, PATCH } from '@/app/api/items/[id]/route';
import { authenticate, writeAuditLog } from '@/lib/api-helpers';
import { casUpdate } from '@/lib/api/cas';

describe('DELETE /api/items/:id — 引用检查仅统计未删除（deletedAt:null）引用', () => {
  let findFirstMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock = vi.fn();
    mockPrisma.item = { findFirst: findFirstMock };
    // 引用出处（问题二）：价格表/项目样本查询
    mockPrisma.priceListItem = { findMany: vi.fn().mockResolvedValue([{ priceList: { code: 'PL-001' } }]) };
    mockPrisma.projectProduct = { findMany: vi.fn().mockResolvedValue([{ project: { code: 'PJ-001' } }]) };
    mockPrisma.$transaction = vi.fn((fn: (t: Record<string, unknown>) => Promise<unknown>) =>
      fn({
        itemSpecification: { updateMany: vi.fn().mockResolvedValue({}) },
        uomConversion: { updateMany: vi.fn().mockResolvedValue({}) },
        itemCost: { updateMany: vi.fn().mockResolvedValue({}) },
        supplierItem: { updateMany: vi.fn().mockResolvedValue({}) },
        itemRevision: { updateMany: vi.fn().mockResolvedValue({}) },
        itemTag: { updateMany: vi.fn().mockResolvedValue({}) },
        item: { update: vi.fn().mockResolvedValue({}) },
      }),
    );
  });

  function makeDeleteRequest(id = 'item-1'): NextRequest {
    return new NextRequest(`http://localhost/api/items/${id}`, { method: 'DELETE' });
  }

  it('无任何引用 → 200 软删除', async () => {
    findFirstMock
      .mockResolvedValueOnce({ id: 'item-1', code: 'ITM-001', name: '轴承', deletedAt: null })
      .mockResolvedValueOnce({ _count: { priceListItems: 0, projectProducts: 0 } });
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: 'item-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
  });

  it('存在未删除的有效引用（projectProducts>0）→ 409 CONFLICT + 引用出处（项目编号）', async () => {
    findFirstMock
      .mockResolvedValueOnce({ id: 'item-1', code: 'ITM-001', name: '轴承', deletedAt: null })
      .mockResolvedValueOnce({ _count: { priceListItems: 0, projectProducts: 1 } });
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: 'item-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
    // 问题二：提示引用出处（实体 + 条数 + 真实项目编号）
    expect(body.error.message).toContain('物料「ITM-001 轴承」已被引用，不能删除：项目产品 1 条（PJ-001）');
    expect(body.error.details.references).toEqual([
      expect.objectContaining({ entity: '项目产品', count: 1, samples: ['PJ-001'] }),
    ]);
  });

  it('存在价格表单价引用（priceListItems>0）→ 409 + 引用出处（价格表编码）', async () => {
    findFirstMock
      .mockResolvedValueOnce({ id: 'item-1', code: 'ITM-001', name: '轴承', deletedAt: null })
      .mockResolvedValueOnce({ _count: { priceListItems: 1, projectProducts: 0 } });
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: 'item-1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toContain('价格表单价 1 条（PL-001）');
  });

  it('物料不存在 → 404 NOT_FOUND', async () => {
    findFirstMock.mockResolvedValue(null);
    const res = await DELETE(makeDeleteRequest('item-x'), { params: Promise.resolve({ id: 'item-x' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

/**
 * PATCH /api/items/:id —「类型」自由文本 → 物料分类（categoryName 优先于 categoryId）
 * 红线：解析/新建分类与 CAS 更新同事务；CAS 冲突必须回滚（不得留下孤儿分类）。
 */
type MockFn = ReturnType<typeof vi.fn>;

interface PatchTxMock {
  itemCategory: { findFirst: MockFn; findMany: MockFn; create: MockFn; findUniqueOrThrow: MockFn };
}

interface PatchTxOptions {
  /** 按名称预查已命中的分类 id（null = 未命中） */
  existingCategoryId?: string | null;
  /** 现有 level=1 顶层 categoryPath */
  usedPaths?: string[];
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

function makePatchTx(options: PatchTxOptions = {}): PatchTxMock {
  const { existingCategoryId = null, usedPaths = [], createdCategoryId = 'cat-new' } = options;
  const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: createdCategoryId, ...args.data }));
  const tx: PatchTxMock = {
    itemCategory: {
      findFirst: vi.fn(async () => (existingCategoryId ? { id: existingCategoryId } : null)),
      findMany: vi.fn(async () => usedPaths.map((categoryPath) => ({ categoryPath }))),
      create,
      findUniqueOrThrow: vi.fn(async () => {
        const lastCreate = create.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> } | undefined;
        return { id: createdCategoryId, ...(lastCreate?.data ?? {}) };
      }),
    },
  };
  return tx;
}

/** $transaction mock：回调抛错 = 真实 Prisma 回滚并重抛（onRollback 观测回滚是否发生） */
function wirePatchTransaction(tx: PatchTxMock, onRollback?: () => void) {
  mockPrisma.$transaction = vi.fn(async (fn: (client: PatchTxMock) => Promise<unknown>) => {
    try {
      return await fn(tx);
    } catch (error) {
      onRollback?.();
      throw error;
    }
  });
}

describe('PATCH /api/items/:id —「类型」文字解析/新建物料分类', () => {
  let findFirstMock: MockFn;

  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock = vi.fn();
    mockPrisma.item = { findFirst: findFirstMock };
    vi.mocked(authenticate).mockResolvedValue(sessionUser(['item:edit', 'item-category:create']));
  });

  function makePatchRequest(body: unknown, id = 'item-1'): NextRequest {
    return new NextRequest(`http://localhost/api/items/${id}`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('① categoryName 命中已有分类 → 复用不新建，CAS 更新写入该 categoryId', async () => {
    const tx = makePatchTx({ existingCategoryId: 'cat-existing' });
    wirePatchTransaction(tx);
    vi.mocked(casUpdate).mockResolvedValue({ outcome: 'OK' });
    findFirstMock
      .mockResolvedValueOnce({ id: 'item-1', name: '轴承', itemType: 'PURCHASED_PART', status: 'ACTIVE', deletedAt: null })
      .mockResolvedValueOnce({ id: 'item-1', name: '轴承', itemType: 'PURCHASED_PART', status: 'ACTIVE' });

    const res = await PATCH(makePatchRequest({ version: 1, categoryName: ' 轴承 ' }), {
      params: Promise.resolve({ id: 'item-1' }),
    });

    expect(res.status).toBe(200);
    expect(tx.itemCategory.create).not.toHaveBeenCalled();
    const findArgs = tx.itemCategory.findFirst.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(findArgs.where).toMatchObject({ name: { equals: '轴承', mode: 'insensitive' }, deletedAt: null });
    const casArgs = vi.mocked(casUpdate).mock.calls[0];
    expect(casArgs[0]).toBe(tx); // 必须在事务客户端上执行 CAS
    expect(casArgs[1]).toBe('item');
    expect(casArgs[4].categoryId).toBe('cat-existing');
    expect('categoryName' in casArgs[4]).toBe(false);
  });

  it('② 未命中且有 item-category:create → 新建分类并写入 item + 分类审计', async () => {
    const tx = makePatchTx({ usedPaths: ['001'] });
    wirePatchTransaction(tx);
    vi.mocked(casUpdate).mockResolvedValue({ outcome: 'OK' });
    findFirstMock
      .mockResolvedValueOnce({ id: 'item-1', name: '轴承', itemType: 'PURCHASED_PART', status: 'ACTIVE', deletedAt: null })
      .mockResolvedValueOnce({ id: 'item-1', name: '轴承', itemType: 'PURCHASED_PART', status: 'ACTIVE' });

    const res = await PATCH(makePatchRequest({ version: 1, categoryName: '直线导轨' }), {
      params: Promise.resolve({ id: 'item-1' }),
    });

    expect(res.status).toBe(200);
    const categoryArgs = tx.itemCategory.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(categoryArgs.data).toMatchObject({ code: 'MAT-002', name: '直线导轨', categoryPath: '002', level: 1 });
    expect(vi.mocked(casUpdate).mock.calls[0][4].categoryId).toBe('cat-new');
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'item-category.create',
        entityType: 'item-category',
        entityId: 'cat-new',
        afterData: expect.objectContaining({ code: 'MAT-002', categoryPath: '002', level: 1, autoCreatedFromItem: true }),
      }),
    );
  });

  it('③ 未命中且无 item-category:create → 403，不新建分类、不执行 CAS 更新（事务回滚）', async () => {
    vi.mocked(authenticate).mockResolvedValue(sessionUser(['item:edit']));
    const tx = makePatchTx();
    let rolledBack = false;
    wirePatchTransaction(tx, () => {
      rolledBack = true;
    });
    findFirstMock.mockResolvedValueOnce({ id: 'item-1', name: '轴承', deletedAt: null });

    const res = await PATCH(makePatchRequest({ version: 1, categoryName: '新类型' }), {
      params: Promise.resolve({ id: 'item-1' }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('item-category:create');
    expect(tx.itemCategory.create).not.toHaveBeenCalled();
    expect(vi.mocked(casUpdate)).not.toHaveBeenCalled();
    expect(rolledBack).toBe(true);
  });

  it('④ 版本冲突（CAS CONFLICT）→ 事务回滚，已新建的分类不落库，返回 409 VERSION_CONFLICT', async () => {
    const tx = makePatchTx();
    let rolledBack = false;
    wirePatchTransaction(tx, () => {
      rolledBack = true;
    });
    vi.mocked(casUpdate).mockResolvedValue({ outcome: 'CONFLICT' });
    findFirstMock.mockResolvedValueOnce({ id: 'item-1', name: '轴承', deletedAt: null });

    const res = await PATCH(makePatchRequest({ version: 1, categoryName: '新类型' }), {
      params: Promise.resolve({ id: 'item-1' }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('VERSION_CONFLICT');
    // 分类确实已创建过 → 必须靠事务回滚消除（无孤儿分类）
    expect(tx.itemCategory.create).toHaveBeenCalledTimes(1);
    expect(rolledBack).toBe(true);
    // 回滚路径不得写任何审计（物料更新与分类新建都没有提交）
    expect(vi.mocked(writeAuditLog)).not.toHaveBeenCalled();
  });
});
