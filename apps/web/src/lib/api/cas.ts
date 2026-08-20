/**
 * 原子乐观锁更新助手（CTO 仓库巡检代码审计 P1：CRUD 乐观锁非原子 TOCTOU）
 *
 * 原模式：read version → check → update version+1（并发双读旧 version 同时通过 → last-write-wins）
 * 原子模式：updateMany({ where: { id, version, deletedAt: null } }) + count===0 → NOT_FOUND/CONFLICT
 * 用法：const cas = await casUpdate(prisma, 'invoice', id, version, { ...fields, updatedById });
 */

import { Prisma, PrismaClient } from '@prisma/client';

interface CasDelegate {
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  findFirst(args: { where: Record<string, unknown>; select?: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
}

export type CasResult = { outcome: 'OK' } | { outcome: 'NOT_FOUND' } | { outcome: 'CONFLICT' };

export async function casUpdate(
  client: Prisma.TransactionClient | PrismaClient,
  model: string,
  id: string,
  version: number,
  data: Record<string, unknown>,
): Promise<CasResult> {
  // 受控 cast：Prisma client 按模型名索引 delegate（模型名由调用方传字面量，白名单语义）
  const delegate = (client as unknown as Record<string, CasDelegate>)[model];
  const res = await delegate.updateMany({
    where: { id, version, deletedAt: null },
    data: { ...data, version: { increment: 1 } },
  });
  if (res.count > 0) return { outcome: 'OK' };
  const exists = await delegate.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  return exists ? { outcome: 'CONFLICT' } : { outcome: 'NOT_FOUND' };
}
