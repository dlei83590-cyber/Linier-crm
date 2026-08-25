import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: {} as Record<string, unknown> }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { runDingTalkSender } from "./sender";

function makeTx(rows: Array<{ id: string; eventType: string; payload: unknown }>) {
  return {
    $queryRaw: vi.fn().mockResolvedValue(rows),
    outboxMessage: { updateMany: vi.fn().mockResolvedValue({ count: rows.length }) },
  };
}

describe("sender — DingTalk Channel Sender（Migration 0055）", () => {
  const env = process.env.DINGTALK_CHANNELS_JSON;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DINGTALK_CHANNELS_JSON = JSON.stringify({
      "sales-group": { name: "销售协同群", webhook: "https://oapi.dingtalk.com/robot/send?access_token=abc", secret: "SEC" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 })));
  });
  afterEach(() => {
    if (env === undefined) delete process.env.DINGTALK_CHANNELS_JSON;
    else process.env.DINGTALK_CHANNELS_JSON = env;
    vi.unstubAllGlobals();
  });

  it("成功：claim → POST 钉钉 → SENT", async () => {
    const tx = makeTx([{ id: "o1", eventType: "CRM_CHECK_IN", payload: { channelKey: "sales-group", businessPartnerId: "bp-1", customerName: "客户A" } }]);
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const update = vi.fn().mockResolvedValue({ id: "o1" });
    mockPrisma.outboxMessage = { update, updateMany: vi.fn(), findUnique: vi.fn() };
    const results = await runDingTalkSender();
    expect(results).toEqual([{ outboxId: "o1", eventType: "CRM_CHECK_IN", outcome: "SENT" }]);
    // claim 置 PROCESSING
    expect(tx.outboxMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PROCESSING" }) }),
    );
    // 成功 → SENT + processedAt
    const updateArgs = update.mock.calls[0][0];
    expect(updateArgs.where.id).toBe("o1");
    expect(updateArgs.data.status).toBe("SENT");
    expect(updateArgs.data.processedAt).toBeInstanceOf(Date);
  });

  it("失败：POST 抛错 → FAILED + attemptCount + nextAttemptAt（可重试），业务事实已提交不受影响", async () => {
    const tx = makeTx([{ id: "o2", eventType: "ORDER_STAGE_CHANGED", payload: { channelKey: "sales-group", salesOrderId: "so-1", salesOrderCode: "SO-1" } }]);
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const update = vi.fn().mockResolvedValue({ id: "o2" });
    mockPrisma.outboxMessage = { update, updateMany: vi.fn(), findUnique: vi.fn().mockResolvedValue({ attemptCount: 1 }) };
    // 钉钉返回非 0 errcode（模拟外部渠道失败）
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ errcode: 310000, errmsg: "keywords not in content" }), { status: 200 })));
    const results = await runDingTalkSender();
    expect(results).toEqual([{ outboxId: "o2", eventType: "ORDER_STAGE_CHANGED", outcome: "FAILED" }]);
    const updateArgs = update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe("FAILED");
    expect(updateArgs.data.attemptCount).toBe(2);
    expect(updateArgs.data.nextAttemptAt).toBeInstanceOf(Date);
    expect(updateArgs.data.lastError).toContain("DINGTALK_SEND_FAILED");
  });

  it("channel 未配置（业务已存 key 但环境缺配置）→ FAILED 可重试，不 DEAD_LETTER 过早", async () => {
    const tx = makeTx([{ id: "o3", eventType: "CRM_CHECK_IN", payload: { channelKey: "missing-group" } }]);
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const update = vi.fn().mockResolvedValue({ id: "o3" });
    mockPrisma.outboxMessage = { update, updateMany: vi.fn(), findUnique: vi.fn().mockResolvedValue({ attemptCount: 0 }) };
    const results = await runDingTalkSender();
    expect(results).toEqual([{ outboxId: "o3", eventType: "CRM_CHECK_IN", outcome: "FAILED" }]);
    expect(update.mock.calls[0][0].data.lastError).toContain("DINGTALK_CHANNEL_NOT_CONFIGURED");
  });

  it("超过 MAX_ATTEMPTS → DEAD_LETTER", async () => {
    const tx = makeTx([{ id: "o4", eventType: "CRM_CHECK_IN", payload: { channelKey: "missing-group" } }]);
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const update = vi.fn().mockResolvedValue({ id: "o4" });
    mockPrisma.outboxMessage = { update, updateMany: vi.fn(), findUnique: vi.fn().mockResolvedValue({ attemptCount: 10 }) };
    const results = await runDingTalkSender();
    expect(results).toEqual([{ outboxId: "o4", eventType: "CRM_CHECK_IN", outcome: "DEAD_LETTER" }]);
    expect(update.mock.calls[0][0].data.status).toBe("DEAD_LETTER");
  });

  it("无待发送消息 → 空结果", async () => {
    const tx = makeTx([]);
    mockPrisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockPrisma.outboxMessage = { update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() };
    const results = await runDingTalkSender();
    expect(results).toEqual([]);
    expect(tx.outboxMessage.updateMany).not.toHaveBeenCalled();
  });
});
