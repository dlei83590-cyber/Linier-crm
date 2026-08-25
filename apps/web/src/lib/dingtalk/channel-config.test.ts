import { describe, it, expect, afterEach } from "vitest";
import { parseDingTalkChannelsJson, listDingTalkChannels, absoluteDeepLink } from "./channel-config";

const ENV_BACKUP = process.env.DINGTALK_CHANNELS_JSON;

describe("channel-config — DingTalk Channel 配置（Migration 0055）", () => {
  it("解析合法 DINGTALK_CHANNELS_JSON（含 name/webhook/secret 与无 secret）", () => {
    const channels = parseDingTalkChannelsJson(
      JSON.stringify({
        "sales-group": { name: "销售协同群", webhook: "https://oapi.dingtalk.com/robot/send?access_token=abc", secret: "SEC123" },
        "ops-group": { webhook: "https://oapi.dingtalk.com/robot/send?access_token=def" },
      }),
    );
    expect(Object.keys(channels)).toEqual(["sales-group", "ops-group"]);
    expect(channels["sales-group"]).toEqual({
      key: "sales-group",
      name: "销售协同群",
      webhook: "https://oapi.dingtalk.com/robot/send?access_token=abc",
      secret: "SEC123",
    });
    expect(channels["ops-group"].secret).toBeNull();
  });

  it("未配置 / 空串 / 非法 JSON / 非法 schema → 空表（fail closed）", () => {
    expect(parseDingTalkChannelsJson(undefined)).toEqual({});
    expect(parseDingTalkChannelsJson("")).toEqual({});
    expect(parseDingTalkChannelsJson("not-json")).toEqual({});
    // webhook 非 https → 非法
    expect(parseDingTalkChannelsJson(JSON.stringify({ k: { webhook: "http://x" } }))).toEqual({});
    // 缺 webhook → 非法
    expect(parseDingTalkChannelsJson(JSON.stringify({ k: { name: "x" } }))).toEqual({});
  });

  it("listDingTalkChannels 只返回 key + name（绝不暴露 webhook/secret）", () => {
    process.env.DINGTALK_CHANNELS_JSON = JSON.stringify({
      k1: { name: "群A", webhook: "https://oapi.dingtalk.com/robot/send?access_token=SECRET_TOKEN", secret: "SEC123" },
    });
    const summaries = listDingTalkChannels();
    expect(summaries).toEqual([{ key: "k1", name: "群A" }]);
    expect(JSON.stringify(summaries)).not.toContain("SECRET_TOKEN");
    expect(JSON.stringify(summaries)).not.toContain("SEC123");
  });

  it("absoluteDeepLink：有基址 → 绝对 URL；无基址 → 相对路径", () => {
    expect(absoluteDeepLink("https://app.example.com", "/business-partners/bp1")).toBe("https://app.example.com/business-partners/bp1");
    expect(absoluteDeepLink("https://app.example.com/", "/sales/orders/so1")).toBe("https://app.example.com/sales/orders/so1");
    expect(absoluteDeepLink("", "/business-partners/bp1")).toBe("/business-partners/bp1");
  });

  afterEach(() => {
    if (ENV_BACKUP === undefined) delete process.env.DINGTALK_CHANNELS_JSON;
    else process.env.DINGTALK_CHANNELS_JSON = ENV_BACKUP;
  });
});
