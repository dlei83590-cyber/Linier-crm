/**
 * DingTalk Channel Sender（合同功能收口：自建消息底座 + 钉钉酷卡片最小接线）
 *
 * 复用现有 Outbox dispatch 机制（无持续 worker，供 cron/手动经 POST /api/domain-events/consume 触发）：
 * claim（FOR UPDATE SKIP LOCKED，防双 worker）→ PROCESSING lease → 解析 channelKey →
 * 构造 actionCard → POST 钉钉 → SENT（成功）/ FAILED（失败 + 指数退避重试）/ DEAD_LETTER（超限）。
 * 红线：外部渠道失败只是 Outbox 状态（FAILED 可重试），业务事务早已提交成功，互不影响。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadDingTalkChannels, resolveAppBaseUrl } from "./channel-config";
import { postDingTalkRobot } from "./adapter";
import { buildCheckInCard, buildOrderStageCard, isDingTalkEventType } from "./payload";

export const DINGTALK_SENDER_BATCH_SIZE = 20;
export const DINGTALK_MAX_ATTEMPTS = 10;
export const DINGTALK_RETRY_BASE_SECONDS = 30;
export const DINGTALK_RETRY_CAP_SECONDS = 1800; // 30 分钟封顶

interface ClaimedOutboxRow {
  id: string;
  eventType: string;
  payload: unknown;
}

export interface DingTalkSendResult {
  outboxId: string;
  eventType: string;
  outcome: "SENT" | "FAILED" | "DEAD_LETTER";
}

/** 运行一轮 DingTalk Sender。返回本批结果；无待发送消息返回空数组。 */
export async function runDingTalkSender(limit: number = DINGTALK_SENDER_BATCH_SIZE): Promise<DingTalkSendResult[]> {
  const channels = loadDingTalkChannels();
  const baseUrl = resolveAppBaseUrl();

  const claimed = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ClaimedOutboxRow[]>(
      Prisma.sql`SELECT "id", "eventType", "payload" FROM "OutboxMessage" WHERE "eventType" IN ('CRM_CHECK_IN', 'ORDER_STAGE_CHANGED') AND "status" IN ('PENDING', 'FAILED') AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now()) ORDER BY "createdAt" ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED`,
    );
    if (rows.length === 0) return [];
    await tx.outboxMessage.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: "PROCESSING", lockedAt: new Date(), lockedBy: "dingtalk-sender" },
    });
    return rows;
  });

  const results: DingTalkSendResult[] = [];
  for (const row of claimed) {
    if (!isDingTalkEventType(row.eventType)) {
      // 非渠道事件误入（防御）：复位 PENDING 交给 domain-events consumer
      await prisma.outboxMessage.update({ where: { id: row.id }, data: { status: "PENDING", lockedAt: null, lockedBy: null } });
      continue;
    }
    try {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const channelKey = typeof payload.channelKey === "string" ? payload.channelKey : "";
      const channel = channelKey ? channels[channelKey] : undefined;
      if (!channel) {
        throw new Error("DINGTALK_CHANNEL_NOT_CONFIGURED:" + channelKey);
      }
      const body =
        row.eventType === "CRM_CHECK_IN" ? buildCheckInCard(payload, baseUrl) : buildOrderStageCard(payload, baseUrl);
      await postDingTalkRobot({ webhook: channel.webhook, secret: channel.secret, body });
      await prisma.outboxMessage.update({
        where: { id: row.id },
        data: { status: "SENT", processedAt: new Date(), lastError: null, lockedAt: null, lockedBy: null },
      });
      results.push({ outboxId: row.id, eventType: row.eventType, outcome: "SENT" });
    } catch (err) {
      const rowNow = await prisma.outboxMessage.findUnique({ where: { id: row.id }, select: { attemptCount: true } });
      const attempts = (rowNow?.attemptCount ?? 0) + 1;
      if (attempts >= DINGTALK_MAX_ATTEMPTS) {
        await prisma.outboxMessage.update({
          where: { id: row.id },
          data: { status: "DEAD_LETTER", lastError: String(err), lockedAt: null, lockedBy: null },
        });
        results.push({ outboxId: row.id, eventType: row.eventType, outcome: "DEAD_LETTER" });
      } else {
        const backoff = Math.min(DINGTALK_RETRY_BASE_SECONDS * 2 ** (attempts - 1), DINGTALK_RETRY_CAP_SECONDS);
        await prisma.outboxMessage.update({
          where: { id: row.id },
          data: {
            status: "FAILED",
            attemptCount: attempts,
            lastError: String(err),
            nextAttemptAt: new Date(Date.now() + backoff * 1000),
            lockedAt: null,
            lockedBy: null,
          },
        });
        results.push({ outboxId: row.id, eventType: row.eventType, outcome: "FAILED" });
      }
    }
  }
  return results;
}
