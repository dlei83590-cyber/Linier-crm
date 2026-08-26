/**
 * DingTalk 渠道事件 Producer（合同功能收口：自建消息底座 + 钉钉酷卡片最小接线）
 *
 * 与现有 Outbox 完全复用：业务事实事务内 writeDomainEvent（OutboxMessage 原子写，幂等键防重入队），
 * 不造 Message Bus。channelKey 决定投递目标群（payload 内路由用）；webhook/secret 只在 Server 环境。
 * 严禁业务事务直接依赖钉钉成功——本模块只做 Outbox INSERT，投递由 lib/dingtalk/sender 异步完成。
 */
import type { Prisma } from "@prisma/client";
import { writeDomainEvent } from "@/lib/domain-events/writer";

export interface CheckInChannelEventInput {
  activityId: string;
  businessPartnerId: string;
  customerName: string;
  actorId: string;
  actorName: string;
  checkinAt: string; // ISO（服务端 now）
  latitude?: number | null;
  longitude?: number | null;
  locationNote?: string | null;
  distanceMeters?: number | null;
  followUpSummary?: string | null;
  channelKey: string;
}

/** 签到成功 → CRM_CHECK_IN（与 CustomerActivity 创建同事务；幂等键 = 活动 id） */
export async function writeCheckInChannelEvent(tx: Prisma.TransactionClient, input: CheckInChannelEventInput) {
  await writeDomainEvent(tx, {
    eventType: "CRM_CHECK_IN",
    aggregateType: "CustomerActivity",
    aggregateId: input.activityId,
    payload: {
      businessPartnerId: input.businessPartnerId,
      customerName: input.customerName,
      actorId: input.actorId,
      actorName: input.actorName,
      checkinAt: input.checkinAt,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      locationNote: input.locationNote ?? null,
      distanceMeters: input.distanceMeters ?? null,
      followUpSummary: input.followUpSummary ?? null,
      channelKey: input.channelKey,
    },
    idempotencyKey: "CRM_CHECK_IN|" + input.activityId,
  });
}

export interface OrderStageChangedEventInput {
  salesOrderId: string;
  salesOrderCode: string;
  customerId: string;
  customerName: string;
  stage: string; // CONFIRMED | DISPATCHED | PARTIALLY_DELIVERED | DELIVERED
  stageLabel: string;
  totalAmount: string; // Decimal toString（服务端 canonical）
  currency: string;
  updatedAt: string; // ISO
  ownerId?: string | null;
  ownerName?: string | null;
  channelKey: string;
}

/** 订单阶段变更 → ORDER_STAGE_CHANGED（与阶段动作同事务；幂等键 = 订单 + 阶段，防止重复触发重复入队） */
export async function writeOrderStageChangedEvent(tx: Prisma.TransactionClient, input: OrderStageChangedEventInput) {
  await writeDomainEvent(tx, {
    eventType: "ORDER_STAGE_CHANGED",
    aggregateType: "SalesOrder",
    aggregateId: input.salesOrderId,
    payload: {
      salesOrderId: input.salesOrderId,
      salesOrderCode: input.salesOrderCode,
      customerId: input.customerId,
      customerName: input.customerName,
      stage: input.stage,
      stageLabel: input.stageLabel,
      totalAmount: input.totalAmount,
      currency: input.currency,
      updatedAt: input.updatedAt,
      ownerId: input.ownerId ?? null,
      ownerName: input.ownerName ?? null,
      channelKey: input.channelKey,
    },
    idempotencyKey: "ORDER_STAGE_CHANGED|" + input.salesOrderId + "|" + input.stage,
  });
}
