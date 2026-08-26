import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "crypto";
import { dingTalkWebhookSign, postDingTalkRobot, DingTalkSendError } from "./adapter";

describe("adapter — DingTalk 群机器人 Adapter（Migration 0055）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("加签：HMAC-SHA256 + urlEncode（固定向量：secret=SEC, timestamp=1700000000000）", () => {
    const sign = dingTalkWebhookSign("1700000000000", "SEC");
    // 与 Node 直接计算一致（标准钉钉加签规则）
    const expected = encodeURIComponent(
      createHmac("sha256", encodeURIComponent("SEC")).update("1700000000000\nSEC", "utf8").digest("base64"),
    );
    expect(sign).toBe(expected);
    expect(sign.length).toBeGreaterThan(0);
  });

  it("POST 成功：errcode=0 → ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await postDingTalkRobot({
      webhook: "https://oapi.dingtalk.com/robot/send?access_token=abc",
      secret: "SEC",
      body: { msgtype: "actionCard" },
    });
    expect(res.ok).toBe(true);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("timestamp=");
    expect(url).toContain("sign=");
  });

  it("POST 失败：errcode=310000 → 抛 DingTalkSendError（errcode 透传）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ errcode: 310000, errmsg: "keywords not in content" }), { status: 200 })));
    await expect(
      postDingTalkRobot({ webhook: "https://oapi.dingtalk.com/robot/send?access_token=abc", body: { msgtype: "text" } }),
    ).rejects.toMatchObject({ errcode: 310000 });
  });

  it("网络异常 → 抛 DingTalkSendError（errcode=-2）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(
      postDingTalkRobot({ webhook: "https://oapi.dingtalk.com/robot/send?access_token=abc", body: {} }),
    ).rejects.toMatchObject({ errcode: -2 });
  });

  it("DingTalkSendError instanceof Error", () => {
    const err = new DingTalkSendError(1, "x");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("DINGTALK_SEND_FAILED");
  });
});
