import { describe, it, expect, vi } from 'vitest';
import { casUpdate } from '@/lib/api/cas';

/**
 * 原子乐观锁更新单测（审计 P1：消除 read-check-update TOCTOU）
 * 覆盖：OK（count>0）/ CONFLICT（存在但 version 不匹配）/ NOT_FOUND（不存在）。
 */

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    item: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue({ id: 'i1' }),
    },
    ...overrides,
  } as never;
}

describe('casUpdate — 原子乐观锁', () => {
  it('version 匹配 → OK（updateMany count>0）', async () => {
    const client = makeClient();
    const r = await casUpdate(client, 'item', 'i1', 3, { name: 'x' });
    expect(r.outcome).toBe('OK');
    expect((client as any).item.updateMany).toHaveBeenCalledWith({
      where: { id: 'i1', version: 3, deletedAt: null },
      data: { name: 'x', version: { increment: 1 } },
    });
  });
  it('version 不匹配 → CONFLICT（count=0 且记录存在）', async () => {
    const client = makeClient({ item: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findFirst: vi.fn().mockResolvedValue({ id: 'i1' }) } });
    const r = await casUpdate(client, 'item', 'i1', 2, { name: 'x' });
    expect(r.outcome).toBe('CONFLICT');
  });
  it('记录不存在 → NOT_FOUND（count=0 且 findFirst null）', async () => {
    const client = makeClient({ item: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findFirst: vi.fn().mockResolvedValue(null) } });
    const r = await casUpdate(client, 'item', 'i-x', 1, { name: 'x' });
    expect(r.outcome).toBe('NOT_FOUND');
  });
});
