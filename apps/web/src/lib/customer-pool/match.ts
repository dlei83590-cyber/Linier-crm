/**
 * Phase 2C-2 — 客户公海自动匹配（MVP：region scope 触碰规则）
 *
 * 合同原文（ROADMAP v1.43）：「客户公海——①与客户状态衔接，可根据企业需求设定流公海规则，
 * 触碰规则客户自动流入公海，人员按权限周期可自由挑入；②具备多公海能力，支持根据区域、小组设定不同公海规则。」
 *
 * 本 MVP（CTO 授权，不做复杂 Rule Engine）：
 * - 匹配维度 = CustomerPool.scope：REGION → scopeValue === BusinessPartner.region（OQ-1 字符串 EQ，不建字典）；
 * - DEPARTMENT → 需要 partner 归属部门，BusinessPartner 无部门字段（CTO 红线：禁止用 createdById 等推断归属）
 *   → 自动路径跳过（DEPARTMENT 池仅支持手工入池的操作者部门校验，见 POST /api/customer-pools/:id/entries）；
 * - GLOBAL 池无触碰维度，不自动入池（保留手工入池兜底）；
 * - 不评估 CustomerPoolRule.condition（FIELD_MATCH 规则引擎 / priority 仲裁 HOLD）。
 *
 * 触发点（ADR-0053 §6.2「写入即判定」）：POST/PATCH /api/business-partners 写成功后同步调用；
 * best-effort：失败不回滚 BP 主档（仅日志），手工入池 POST /api/customer-pools/:id/entries 仍可兜底。
 *
 * 复用：CustomerPoolEntry（enterReason=FIELD_RULE，枚举已存在，Migration 0049）+
 * CustomerPoolEntryEntered Outbox 事件（EVENTS.md 已注册）+ I1/I2 校验（与手工入池 entries 全校验一致）。
 * 并发兜底：DB partial unique CustomerPoolEntry_one_active_per_partner（Migration 0049）P2002 → RACE_LOST no-op。
 */
import { prisma } from "@/lib/prisma";
import { writeDomainEvent } from "@/lib/domain-events/writer";
import { isPartnerPoolEligible } from "@/lib/customer-pool/validators";

export type MatchCustomerPoolsSkipReason =
  | "PARTNER_NOT_FOUND"
  | "NOT_POOL_ELIGIBLE"
  | "NO_MATCHING_POOL"
  | "HAS_ACTIVE_ENTRY"
  | "HAS_ACTIVE_OWNERSHIP"
  | "RACE_LOST";

export interface MatchCustomerPoolsResult {
  /** 是否存在匹配 scope 的激活池（= 触碰规则命中） */
  matched: boolean;
  /** 命中池（确定性排序 createdAt asc / id asc；MVP 取首个，priority 仲裁 HOLD） */
  poolsMatched: { id: string; code: string }[];
  /** 是否创建了 FIELD_RULE 条目 */
  entryCreated: boolean;
  entryId?: string;
  skippedReason?: MatchCustomerPoolsSkipReason;
}

/**
 * 客户公海自动匹配：REGION scopeValue === BP.region 的激活池命中 → 无 active entry（I2）且
 * 无 active ownership（I1）时创建 CustomerPoolEntry（enterReason=FIELD_RULE）+ Outbox 事件（同事务）。
 * 仅 CUSTOMER/BOTH 客户可入池；意外错误上抛，由调用方 best-effort 吞掉（不回滚 BP 主档）。
 */
export async function matchCustomerPools(partnerId: string): Promise<MatchCustomerPoolsResult> {
  // ① 只读 BP 快照（判定只读既有字段，不推断归属；ADR-0053 §6.3）
  const partner = await prisma.businessPartner.findFirst({
    where: { id: partnerId, deletedAt: null },
    select: { id: true, type: true, region: true },
  });
  if (!partner) return { matched: false, poolsMatched: [], entryCreated: false, skippedReason: "PARTNER_NOT_FOUND" };
  if (!isPartnerPoolEligible(partner.type)) {
    return { matched: false, poolsMatched: [], entryCreated: false, skippedReason: "NOT_POOL_ELIGIBLE" };
  }

  // ② 命中激活池（scope 触碰规则）：REGION → scopeValue === BP.region；
  //    DEPARTMENT 自动路径跳过（BP 无部门字段）；GLOBAL 不自动入池；BP 无 region → 无 REGION 池可命中
  const region = partner.region?.trim();
  if (!region) return { matched: false, poolsMatched: [], entryCreated: false, skippedReason: "NO_MATCHING_POOL" };
  const pools = await prisma.customerPool.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      OR: [{ scopeType: "REGION" as const, scopeValue: region }],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, code: true },
  });
  if (pools.length === 0) {
    return { matched: false, poolsMatched: [], entryCreated: false, skippedReason: "NO_MATCHING_POOL" };
  }
  const poolsMatched = pools.map((p) => ({ id: p.id, code: p.code }));
  const targetPool = pools[0];

  // ③ 事务：I2 无 active entry + I1 无 active ownership → 创建 FIELD_RULE 条目 + Outbox 同事务
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const activeEntry = await tx.customerPoolEntry.findFirst({
        where: { businessPartnerId: partnerId, status: { not: "RELEASED" }, deletedAt: null },
        select: { id: true },
      });
      if (activeEntry) return { kind: "hasActiveEntry" as const };

      const activeOwnership = await tx.customerOwnership.findFirst({
        where: { businessPartnerId: partnerId, releasedAt: null, deletedAt: null },
        select: { id: true },
      });
      if (activeOwnership) return { kind: "hasActiveOwnership" as const };

      const entry = await tx.customerPoolEntry.create({
        data: {
          poolId: targetPool.id,
          businessPartnerId: partnerId,
          status: "IN_POOL",
          enterReason: "FIELD_RULE",
          enteredById: null,
          createdById: null,
          updatedById: null,
        },
      });

      await writeDomainEvent(tx, {
        eventType: "CustomerPoolEntryEntered",
        aggregateType: "CustomerPoolEntry",
        aggregateId: entry.id,
        payload: {
          entryId: entry.id,
          poolId: targetPool.id,
          businessPartnerId: partnerId,
          enterReason: "FIELD_RULE",
          enteredBy: null,
        },
        idempotencyKey: "CustomerPoolEntryEntered|" + entry.id,
      });

      return { kind: "created" as const, entryId: entry.id };
    });

    if (outcome.kind === "hasActiveEntry") {
      return { matched: true, poolsMatched, entryCreated: false, skippedReason: "HAS_ACTIVE_ENTRY" };
    }
    if (outcome.kind === "hasActiveOwnership") {
      return { matched: true, poolsMatched, entryCreated: false, skippedReason: "HAS_ACTIVE_OWNERSHIP" };
    }
    return { matched: true, poolsMatched, entryCreated: true, entryId: outcome.entryId };
  } catch (err) {
    // 并发双入池撞 CustomerPoolEntry_one_active_per_partner → no-op（I2 DB 兜底）
    if (err !== null && typeof err === "object" && (err as { code?: unknown }).code === "P2002") {
      return { matched: true, poolsMatched, entryCreated: false, skippedReason: "RACE_LOST" };
    }
    throw err; // 意外错误上抛 → 调用方 best-effort 吞掉（不回滚 BP 主档）
  }
}
