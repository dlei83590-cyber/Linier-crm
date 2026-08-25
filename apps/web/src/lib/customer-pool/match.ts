/**
 * Phase 2C-2 — 客户公海自动匹配（REGION + DEPARTMENT scope 触碰规则，无 Rule Engine）
 *
 * 合同原文（ROADMAP v1.43）：「客户公海——①与客户状态衔接，可根据企业需求设定流公海规则，
 * 触碰规则客户自动流入公海，人员按权限周期可自由挑入；②具备多公海能力，支持根据区域、小组设定不同公海规则。」
 *
 * 匹配维度（极小，不造 Rule Engine / condition DSL / priority engine / scheduler）：
 * - REGION → scopeValue === BusinessPartner.region（OQ-1 字符串 EQ，不建字典）；
 * - DEPARTMENT → CustomerOwnership.ownerId → User.departmentId === scopeValue
 *   （grep 确认 BusinessPartner 无 department/team 真实字段（ADR-0053 §3.1/§3.3），归属 SSOT = CustomerOwnership；
 *   禁止用 createdById 等推断归属）；
 * - GLOBAL 池无触碰维度，不自动入池（保留手工入池兜底）；
 * - 不评估 CustomerPoolRule.condition（FIELD_MATCH 规则引擎 / priority 仲裁 HOLD）。
 *
 * 触发点（ADR-0053 §6.2「写入即判定」）：POST/PATCH /api/business-partners 写成功后同步调用；
 * POST /api/customer-pools/:id/entries/:entryId/claim（客户负责人变更）后同步调用；
 * best-effort：失败不回滚 BP 主档 / claim（仅日志），手工入池 POST /api/customer-pools/:id/entries 仍可兜底。
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
  | "MATCH_CONDITION_CHANGED"
  | "RACE_LOST";

export interface MatchCustomerPoolsResult {
  /** 是否存在匹配 scope 的激活池（= 触碰规则命中） */
  matched: boolean;
  /** 命中池（确定性排序：DEPARTMENT（客户负责人部门，触发源）优先 → REGION；同 scope 内 createdAt asc / id asc；MVP 取首个，priority 仲裁 HOLD） */
  poolsMatched: { id: string; code: string }[];
  /** 是否创建了 FIELD_RULE 条目 */
  entryCreated: boolean;
  entryId?: string;
  skippedReason?: MatchCustomerPoolsSkipReason;
}

/** scope 优先级：DEPARTMENT（客户负责人部门 = 触发源）优先于 REGION（OQ-1 区域字符串） */
function scopeRank(scopeType: string): number {
  return scopeType === "DEPARTMENT" ? 0 : 1;
}

/**
 * 客户公海自动匹配：
 * - REGION：scopeValue === BP.region 的激活池命中，且无 active entry（I2）且无 active ownership（I1）
 *   → 创建 CustomerPoolEntry（enterReason=FIELD_RULE）+ Outbox 事件（同事务）；
 * - DEPARTMENT：active ownership（CustomerOwnership.ownerId → User.departmentId）=== scopeValue 的激活池命中，
 *   且无 active entry（I2）→ 创建 FIELD_RULE 条目 + Outbox 事件（同事务）；I1 不适用（归属即触发源，事务内复核）。
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

  // ② 归属快照：DEPARTMENT 维度唯一事实源 = CustomerOwnership.ownerId → User.departmentId
  const ownership = await prisma.customerOwnership.findFirst({
    where: { businessPartnerId: partnerId, releasedAt: null, deletedAt: null },
    select: { id: true, owner: { select: { departmentId: true } } },
  });
  const departmentId = ownership?.owner.departmentId ?? null;

  // ③ 命中激活池（scope 触碰规则）：REGION → scopeValue === BP.region；DEPARTMENT → scopeValue === owner.departmentId；
  //    GLOBAL 不自动入池；两个维度都无值 → 无池可命中（NO_MATCHING_POOL no-op）
  const region = partner.region?.trim() ?? "";
  const scopeConditions: Array<{ scopeType: "REGION" | "DEPARTMENT"; scopeValue: string }> = [];
  if (region) scopeConditions.push({ scopeType: "REGION", scopeValue: region });
  if (departmentId) scopeConditions.push({ scopeType: "DEPARTMENT", scopeValue: departmentId });
  if (scopeConditions.length === 0) {
    return { matched: false, poolsMatched: [], entryCreated: false, skippedReason: "NO_MATCHING_POOL" };
  }

  const pools = await prisma.customerPool.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      OR: scopeConditions.map((c) => ({ scopeType: c.scopeType, scopeValue: c.scopeValue })),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, code: true, scopeType: true },
  });
  if (pools.length === 0) {
    return { matched: false, poolsMatched: [], entryCreated: false, skippedReason: "NO_MATCHING_POOL" };
  }
  // 确定性排序（稳定排序保持同 scope 内 createdAt asc / id asc；MVP 取首个，priority 仲裁 HOLD）
  const poolsSorted = [...pools].sort((a, b) => scopeRank(a.scopeType) - scopeRank(b.scopeType));
  const poolsMatched = poolsSorted.map((p) => ({ id: p.id, code: p.code }));
  const targetPool = poolsSorted[0];

  // ④ 事务：I2 无 active entry → 创建 FIELD_RULE 条目 + Outbox 同事务
  //    I1（无 active ownership）仅约束 REGION 自动入池（防已负责客户流入区域公海）；
  //    DEPARTMENT 的触发源就是客户负责人，事务内复核归属快照仍成立（owner.departmentId === scopeValue）。
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const activeEntry = await tx.customerPoolEntry.findFirst({
        where: { businessPartnerId: partnerId, status: { not: "RELEASED" }, deletedAt: null },
        select: { id: true },
      });
      if (activeEntry) return { kind: "hasActiveEntry" as const };

      if (targetPool.scopeType === "REGION") {
        const activeOwnership = await tx.customerOwnership.findFirst({
          where: { businessPartnerId: partnerId, releasedAt: null, deletedAt: null },
          select: { id: true },
        });
        if (activeOwnership) return { kind: "hasActiveOwnership" as const };
      } else {
        // DEPARTMENT：事务内复核（快照过期竞态：归属在判定与提交之间被释放 → 不创建，防假入池）
        const current = await tx.customerOwnership.findFirst({
          where: { businessPartnerId: partnerId, releasedAt: null, deletedAt: null },
          select: { owner: { select: { departmentId: true } } },
        });
        if ((current?.owner.departmentId ?? null) !== targetPool.scopeValue) {
          return { kind: "conditionChanged" as const };
        }
      }

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
    if (outcome.kind === "conditionChanged") {
      return { matched: false, poolsMatched, entryCreated: false, skippedReason: "MATCH_CONDITION_CHANGED" };
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
