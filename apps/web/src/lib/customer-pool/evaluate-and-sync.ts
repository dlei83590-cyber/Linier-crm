/**
 * Phase 2C-2 — Customer Pool 自动入池联动服务（BP 写入联动 + sweep 共用）
 *
 * CTO 裁决：
 * - BP create/update 成功后调用；**失败不能回滚 BP 主档事务**（Pool 是派生归属自动化，
 *   规则配置错误不得阻止客户主档保存）→ best-effort：request log + pool evaluation error audit，sweep 可修复
 * - 纯确定性评估（rule-evaluator）；MATCH → 同事务入池 + Outbox CustomerPoolEntryEntered；
 *   AMBIGUOUS → 不自动入池 + Audit ambiguous（NO AUTO ENTRY，禁止随机选池）
 * - idempotent：已有 active entry/ownership → UNCHANGED（partial unique 兜底）
 */
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/api-helpers";
import { writeDomainEvent } from "@/lib/domain-events/writer";
import { evaluateCustomerPoolRules, type ActivePoolRuleView } from "./rule-evaluator";
import { isPartnerPoolEligible, type RuleConditionItem } from "./validators";

export type SyncOutcome = "ENTERED" | "UNCHANGED" | "AMBIGUOUS" | "NO_MATCH" | "INELIGIBLE" | "FAILED";

export async function syncPartnerToPool(
  businessPartnerId: string,
  actorId?: string | null,
): Promise<SyncOutcome> {
  try {
    const partner = await prisma.businessPartner.findFirst({
      where: { id: businessPartnerId, deletedAt: null },
      select: { id: true, type: true, region: true, industry: true, sourceChannel: true, isActive: true, deletedAt: true },
    });
    if (!partner) return "INELIGIBLE";
    if (!isPartnerPoolEligible(partner.type)) return "INELIGIBLE";

    const rules = await prisma.customerPoolRule.findMany({
      where: { isActive: true, deletedAt: null, ruleType: "FIELD_MATCH", pool: { isActive: true, deletedAt: null } },
      select: {
        id: true,
        poolId: true,
        ruleType: true,
        priority: true,
        matchMode: true,
        condition: true,
        pool: { select: { code: true, name: true, scopeType: true, scopeValue: true } },
      },
      orderBy: { priority: "desc" },
    });

    const view: ActivePoolRuleView[] = rules.map((r) => ({
      poolId: r.poolId,
      poolCode: r.pool.code,
      poolName: r.pool.name,
      poolScopeType: r.pool.scopeType,
      poolScopeValue: r.pool.scopeValue,
      ruleId: r.id,
      ruleType: r.ruleType,
      matchMode: r.matchMode as "ALL" | "ANY",
      condition: r.condition as RuleConditionItem[],
      priority: r.priority,
    }));

    const outcome = evaluateCustomerPoolRules(
      { id: partner.id, type: partner.type, region: partner.region, industry: partner.industry, sourceChannel: partner.sourceChannel, isActive: partner.isActive, deletedAt: partner.deletedAt },
      view,
    );

    if (outcome.status === "NO_MATCH") return "NO_MATCH";
    if (outcome.status === "AMBIGUOUS") {
      // 同 priority 多池命中 → NO AUTO ENTRY + Audit ambiguous（sweep 结果标记 conflict）
      await writeAuditLog({
        actorId: actorId ?? null,
        action: "customer-pool-entry.auto-enter-ambiguous",
        entityType: "businessPartner",
        entityId: partner.id,
        afterData: {
          matchedPoolIds: outcome.ties.map((t) => t.poolId),
          matchReasons: ["MULTI_POOL_SAME_PRIORITY"],
        },
      });
      return "AMBIGUOUS";
    }

    // MATCH → 同事务入池（enterReason=FIELD_RULE）+ Outbox 同事务
    let entered = false;
    await prisma.$transaction(async (tx) => {
      const activeEntry = await tx.customerPoolEntry.findFirst({
        where: { businessPartnerId: partner.id, status: { not: "RELEASED" }, deletedAt: null },
        select: { id: true },
      });
      if (activeEntry) return; // 已在池 → UNCHANGED
      const activeOwnership = await tx.customerOwnership.findFirst({
        where: { businessPartnerId: partner.id, releasedAt: null, deletedAt: null },
        select: { id: true },
      });
      if (activeOwnership) return; // 已被领养 → UNCHANGED

      const entry = await tx.customerPoolEntry.create({
        data: {
          poolId: outcome.winner.poolId,
          businessPartnerId: partner.id,
          status: "IN_POOL",
          enterReason: "FIELD_RULE",
          enteredById: actorId ?? null,
          createdById: actorId ?? null,
          updatedById: actorId ?? null,
        },
      });
      entered = true;

      await writeDomainEvent(tx, {
        eventType: "CustomerPoolEntryEntered",
        aggregateType: "CustomerPoolEntry",
        aggregateId: entry.id,
        payload: {
          entryId: entry.id,
          poolId: outcome.winner.poolId,
          businessPartnerId: partner.id,
          enterReason: "FIELD_RULE",
          enteredBy: actorId ?? null,
        },
        idempotencyKey: "CustomerPoolEntryEntered|" + entry.id,
      });
    });

    return entered ? "ENTERED" : "UNCHANGED";
  } catch (err) {
    // best-effort：失败不回滚 BP 主档；request log + pool evaluation error audit，sweep 可修复
    console.error(
      JSON.stringify({
        level: "error",
        action: "customer-pool.evaluate-and-sync",
        businessPartnerId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    try {
      await writeAuditLog({
        actorId: actorId ?? null,
        action: "customer-pool-entry.auto-enter-failed",
        entityType: "businessPartner",
        entityId: businessPartnerId,
        afterData: { note: "pool rule evaluation failed; sweep can repair" },
        result: "FAILURE",
      });
    } catch {
      // audit best-effort
    }
    return "FAILED";
  }
}
