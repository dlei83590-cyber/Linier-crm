import { writeAuditLog } from "@/lib/api-helpers";

/** Sprint 4E-2 - WriteOff Domain Events 发布（EVENTS.md v1.10 已注册 WriteOff 事件）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * 覆盖事件（CTO 指令）：WriteOffCreated / WriteOffApprovalStarted / WriteOffApproved /
 * WriteOffRejected / WriteOffApplied / AccountsReceivableWrittenOff。
 * **降级边界（CTO 明确）**：事件发布失败可降级（.catch），但 **WriteOff / AR 的数据库事实更新
 * 不能因为 .catch() 被静默吞掉**——事件与主事务分离，主事务失败整体回滚。
 */

export interface WriteOffEventPayload {
  writeOffId: string;
  writeOffCode?: string | null;
  customerId: string;
  currency: string;
  amount: unknown;
  accountsReceivableIds: string[];
  workflowInstanceId?: string | null;
  reason?: string | null;
  [key: string]: unknown;
}

export async function publishWriteOffEvent(params: {
  eventType: string;
  actorId?: string | null;
  entityId: string;
  payload: WriteOffEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: "write-off",
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
