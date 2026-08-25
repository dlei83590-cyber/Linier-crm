/**
 * DingTalk Channel 配置（合同功能收口：自建消息底座 + 钉钉酷卡片最小接线，Migration 0055）
 *
 * SSOT 分层（红线：secret 永不进 DB / 前端 / git）：
 * - DB（BusinessPartner.collaborationChannelKey）：只存 channel **key**（业务事实，可与环境解耦）；
 * - Server 环境（DINGTALK_CHANNELS_JSON）：\{ [key]: { name?, webhook, secret? } \}——webhook/secret 只在自建 Server 环境。
 *   格式：{\"sales-group\": {\"name\":\"销售协同群\",\"webhook\":\"https://oapi.dingtalk.com/robot/send?access_token=xxx\",\"secret\":\"SECxxx\"}}
 * - secret 缺省 = 机器人未加签（仅 webhook）；提供时按钉钉加签规则签名。
 *
 * 行为契约：环境未配置/格式非法 → fail closed（sender 端该 channel 视为不可投递 → FAILED 可重试），
 * 绝不把 webhook/secret 暴露给前端；listDingTalkChannels 只返回 key + name。
 */
import { z } from "zod";

export interface DingTalkChannelConfig {
  key: string;
  name: string | null;
  webhook: string;
  secret: string | null;
}

/** 前端可读的渠道摘要（无 webhook/secret） */
export interface DingTalkChannelSummary {
  key: string;
  name: string | null;
}

const channelSchema = z
  .object({
    name: z.string().max(100).nullable().optional(),
    webhook: z.string().url().refine((v) => v.startsWith("https://"), { message: "webhook 必须为 https URL" }),
    secret: z.string().min(1).max(200).nullable().optional(),
  })
  .strict();

const channelsSchema = z.record(z.string().min(1).max(64), channelSchema);

/** 解析 DINGTALK_CHANNELS_JSON 原始串 → 渠道表（纯函数，可单测）。非法/空 → 空表（fail closed）。 */
export function parseDingTalkChannelsJson(raw: string | undefined | null): Record<string, DingTalkChannelConfig> {
  if (!raw || !raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const result = channelsSchema.safeParse(parsed);
  if (!result.success) return {};
  const out: Record<string, DingTalkChannelConfig> = {};
  for (const [key, cfg] of Object.entries(result.data)) {
    out[key] = { key, name: cfg.name ?? null, webhook: cfg.webhook, secret: cfg.secret ?? null };
  }
  return out;
}

/** 读取当前 Server 环境渠道表（fail closed：非法配置视为未配置，sender 端 FAILED 可重试）。 */
export function loadDingTalkChannels(): Record<string, DingTalkChannelConfig> {
  return parseDingTalkChannelsJson(process.env.DINGTALK_CHANNELS_JSON);
}

/** 单个渠道配置（未配置 → undefined）。 */
export function getDingTalkChannel(key: string): DingTalkChannelConfig | undefined {
  return loadDingTalkChannels()[key];
}

/** 前端可读渠道列表（仅 key + name；webhook/secret 永不外泄）。 */
export function listDingTalkChannels(): DingTalkChannelSummary[] {
  return Object.values(loadDingTalkChannels()).map((c) => ({ key: c.key, name: c.name }));
}

/**
 * Deep link 基址：优先 DINGTALK_APP_URL（钉钉卡片可点击外部 URL），回退 APP_URL；均未配置 → 空串
 * （卡片仍展示相对路径文本，链接不可点击——Known Limitation，生产需配置环境变量）。
 */
export function resolveAppBaseUrl(): string {
  return (process.env.DINGTALK_APP_URL ?? process.env.APP_URL ?? "").replace(/\/$/, "");
}

/** 组装绝对 deep link（无基址时返回相对路径）。 */
export function absoluteDeepLink(baseUrl: string, path: string): string {
  return baseUrl ? baseUrl + path : path;
}
