/**
 * 物料「类型」自由文本 → 物料分类（按名称解析 / 新建）
 *
 * 产品决策（物料管理持续优化）：物料表单的「类型」不再是 DB 枚举下拉，改为自由文本输入；
 * 服务端按该文字**匹配或新建「物料分类」（ItemCategory）并写入 Item.categoryId**，
 * 类型文字本身不再写 Item.itemType。
 *
 * 本模块只解决「名称 → categoryId」，事务边界由调用方持有：
 * 解析必须与物料写入处于**同一事务**（prisma.$transaction），失败整体回滚，
 * 避免出现「物料保存失败但分类已被建出来」的孤儿分类。
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { fail, failConflict } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";

/** 物料分类名称长度上限（trim 后 1..100） */
export const CATEGORY_NAME_MAX_LENGTH = 100;
/** 自动新建分类的编码前缀（与 seed 的 SLIDER / LINEAR_GUIDE 风格并存，如 MAT-008） */
export const AUTO_CATEGORY_CODE_PREFIX = "MAT-";
/**
 * 分类创建并发冲突（唯一约束 P2002）的**事务级**重试次数上限。
 * ⚠️ 必须在**事务之外**重开事务重试：PostgreSQL 在事务内任一语句报错后，事务立即进入
 * aborted 状态（SQLSTATE 25P02），同一事务内继续查询/写入一律失败——因此
 * resolveCategoryIdByName 只尝试一次，撞车即返回 CONFLICT，由调用方重开事务
 * （见 runWithCategoryConflictRetry）。
 */
export const MAX_CATEGORY_TX_ATTEMPTS = 3;
/** 顶层（level=1）categoryPath 形态：3 位数字（001 / 002 …） */
const TOP_LEVEL_PATH_PATTERN = /^\d{3}$/;

export type CategoryResolveErrorCode =
  | "NAME_INVALID"
  | "FORBIDDEN_CREATE"
  | "PATH_EXHAUSTED"
  | "CONFLICT";

export type ResolveCategoryResult =
  | { ok: true; categoryId: string; created: boolean }
  | { ok: false; error: CategoryResolveErrorCode };

/** 事务客户端或全局 PrismaClient（与 lib/api/cas.ts 的 casUpdate 同风格） */
export type CategoryClient = Prisma.TransactionClient | PrismaClient;

/** 自动新建分类的审计事实（回读 DB 事实，禁止用本地拼接值伪造审计） */
export interface CategoryAuditSnapshot {
  id: string;
  code: string;
  name: string;
  categoryPath: string;
  level: number;
}

/** 名称规范化：仅 trim（大小写不敏感匹配由 DB 的 mode: insensitive 负责） */
export function normalizeCategoryName(raw: string): string {
  return raw.trim();
}

/** Prisma 唯一约束冲突（code / categoryPath 撞车） */
function isUniqueViolation(error: unknown): boolean {
  return error !== null && typeof error === "object" && (error as { code?: unknown }).code === "P2002";
}

/** 按名称查已有分类（大小写/首尾空格不敏感；deletedAt:null 才算有效）→ 命中返回 id */
async function findCategoryIdByName(client: CategoryClient, name: string): Promise<string | null> {
  const existing = await client.itemCategory.findFirst({
    where: { name: { equals: name, mode: "insensitive" as const }, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return existing?.id ?? null;
}

/** 下一个可用的 3 位数字顶层路径（001 / 002 …）；已用满 999 → null（PATH_EXHAUSTED） */
async function nextTopLevelCategoryPath(client: CategoryClient): Promise<string | null> {
  const rows = await client.itemCategory.findMany({
    where: { level: 1, deletedAt: null },
    select: { categoryPath: true },
  });
  let max = 0;
  for (const row of rows) {
    if (!TOP_LEVEL_PATH_PATTERN.test(row.categoryPath)) continue;
    const value = Number.parseInt(row.categoryPath, 10);
    if (Number.isFinite(value) && value > max) max = value;
  }
  const next = max + 1;
  if (next > 999) return null;
  return String(next).padStart(3, "0");
}

/**
 * 按名称解析物料分类：命中即复用（**绝不重复建同名分类**），未命中且 canCreate 时新建。
 *
 * @param client   事务客户端（必须与物料写入同事务）
 * @param name     分类名称（自由文本「类型」，内部 trim）
 * @param actorId  新建分类的创建人/更新人（审计主体）
 * @param canCreate 调用方是否持有 item-category:create（false 时未命中即 FORBIDDEN_CREATE）
 */
export async function resolveCategoryIdByName(
  client: CategoryClient,
  name: string,
  actorId: string,
  canCreate: boolean,
): Promise<ResolveCategoryResult> {
  const normalized = normalizeCategoryName(name);
  if (normalized.length === 0 || normalized.length > CATEGORY_NAME_MAX_LENGTH) {
    return { ok: false, error: "NAME_INVALID" };
  }

  const existingId = await findCategoryIdByName(client, normalized);
  if (existingId) return { ok: true, categoryId: existingId, created: false };

  if (!canCreate) return { ok: false, error: "FORBIDDEN_CREATE" };

  const categoryPath = await nextTopLevelCategoryPath(client);
  if (categoryPath === null) return { ok: false, error: "PATH_EXHAUSTED" };

  try {
    const created = await client.itemCategory.create({
      data: {
        code: `${AUTO_CATEGORY_CODE_PREFIX}${categoryPath}`,
        name: normalized,
        categoryPath,
        level: 1,
        sort: 0,
        createdById: actorId,
        updatedById: actorId,
      },
      select: { id: true },
    });
    return { ok: true, categoryId: created.id, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // 并发撞车（同名分类被并发请求建出 / 两个新名称争同一 categoryPath）：
    // 事务已 aborted，**不能在此重试**——交回调用方重开事务（runWithCategoryConflictRetry）。
    return { ok: false, error: "CONFLICT" };
  }
}

/**
 * 事务级重试：仅针对「分类创建并发撞车」（ItemWriteAbortError → { type: 'category', error: 'CONFLICT' }）
 * 重开一个新事务；其它中止原因（权限/名称非法/路径用尽/CAS 失败）一律直接抛出。
 *
 * 为什么不能在事务内重试：PG 事务内语句失败后进入 aborted（25P02），继续执行一律报错；
 * 重开事务是唯一正确的重试位置（首次尝试已整体回滚，不会重复写入）。
 */
export async function runWithCategoryConflictRetry<T>(
  run: () => Promise<T>,
  attempts: number = MAX_CATEGORY_TX_ATTEMPTS,
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const retryable =
        isItemWriteAbort(error) && error.reason.type === "category" && error.reason.error === "CONFLICT";
      if (!retryable) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/** 读取自动新建分类的审计事实（同事务内回读，保证 code/categoryPath 来自 DB 权威值） */
export async function readCategoryAuditSnapshot(
  client: CategoryClient,
  categoryId: string,
): Promise<CategoryAuditSnapshot> {
  return client.itemCategory.findUniqueOrThrow({
    where: { id: categoryId },
    select: { id: true, code: true, name: true, categoryPath: true, level: true },
  });
}

export type ItemWriteAbortReason =
  | { type: "category"; error: CategoryResolveErrorCode }
  | { type: "cas"; outcome: "NOT_FOUND" | "CONFLICT" };

/**
 * 事务内中止信号：**抛出该错误 → Prisma 回滚整个事务**。
 * 语义：分类解析失败 / 乐观锁失败时事务不得提交——否则会出现「物料保存失败但分类已被建出来」的副作用。
 * 路由在事务外 catch 后映射为 HTTP 响应（failCategoryResolve / 版本冲突 409）。
 */
export class ItemWriteAbortError extends Error {
  readonly reason: ItemWriteAbortReason;

  constructor(reason: ItemWriteAbortReason) {
    super("ITEM_WRITE_ABORT");
    this.name = "ItemWriteAbortError";
    this.reason = reason;
  }
}

export function isItemWriteAbort(error: unknown): error is ItemWriteAbortError {
  return error instanceof ItemWriteAbortError;
}

/** 分类解析失败 → HTTP 响应（400 校验 / 403 权限 / 409 冲突） */
export function failCategoryResolve(error: CategoryResolveErrorCode) {
  if (error === "NAME_INVALID") {
    return fail(ERROR_CODES.VALIDATION_ERROR, "物料分类名称不能为空且不超过 100 字", 400);
  }
  if (error === "FORBIDDEN_CREATE") {
    return fail(
      ERROR_CODES.FORBIDDEN,
      "需要 item-category:create 权限才能新建物料分类，请选择已有分类或联系管理员授权",
      403,
    );
  }
  if (error === "PATH_EXHAUSTED") {
    return failConflict(ERROR_CODES.CONFLICT, "物料分类路径已用尽（顶层 001-999 已满），请先整理物料分类");
  }
  return failConflict(ERROR_CODES.CONFLICT, "物料分类创建冲突，请重试");
}
