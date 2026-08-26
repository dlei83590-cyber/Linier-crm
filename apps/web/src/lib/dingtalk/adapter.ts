/**
 * DingTalk 群机器人 Webhook Adapter（合同功能收口：自建消息底座 + 钉钉酷卡片最小接线）
 *
 * 职责：唯一负责与钉钉外部渠道的 HTTP 交互——加签（HMAC-SHA256）→ POST actionCard（酷卡片）→ 解析 errcode。
 * 红线：本 Adapter 是 Channel Adapter——外部失败抛 DingTalkSendError，由 sender 标记 FAILED 可重试；
 * 绝不让业务事务直接依赖本模块（业务事务只写 Outbox，见 lib/dingtalk/events.ts）。
 */
import { createHmac } from "crypto";

/** 钉钉群机器人加签（timestamp 毫秒串 + secret）：
 *  sign = urlEncode( base64( hmac_sha256( urlEncode(secret), timestamp + "\n" + secret ) ) ) */
export function dingTalkWebhookSign(timestamp: string, secret: string): string {
  const stringToSign = timestamp + "\n" + secret;
  const hmac = createHmac("sha256", encodeURIComponent(secret)).update(stringToSign, "utf8").digest("base64");
  return encodeURIComponent(hmac);
}

/** 外部渠道发送失败（业务事实不受影响；sender 捕获后标记 FAILED + 退避重试） */
export class DingTalkSendError extends Error {
  readonly errcode: number;
  constructor(errcode: number, message: string) {
    super("DINGTALK_SEND_FAILED:" + errcode + ":" + message);
    this.name = "DingTalkSendError";
    this.errcode = errcode;
  }
}

export interface DingTalkRobotResult {
  ok: true;
  errcode: number;
  errmsg: string;
}

/** POST 钉钉群机器人（actionCard 卡片）。secret 缺省 = 不加签。网络/非 0 errcode → 抛 DingTalkSendError。 */
export async function postDingTalkRobot(params: {
  webhook: string;
  secret?: string | null;
  body: unknown;
  timeoutMs?: number;
}): Promise<DingTalkRobotResult> {
  const timestamp = String(Date.now());
  // webhook 已含 access_token；仅追加 timestamp / sign（钉钉加签规则）
  const query = (params.webhook.includes("?") ? "&" : "?") + "timestamp=" + timestamp + (params.secret ? "&sign=" + dingTalkWebhookSign(timestamp, params.secret) : "");
  const cleanUrl = params.webhook + query;
  let res: Response;
  try {
    res = await fetch(cleanUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params.body),
      signal: AbortSignal.timeout(params.timeoutMs ?? 10_000),
    });
  } catch (err) {
    throw new DingTalkSendError(-2, err instanceof Error ? err.message : String(err));
  }
  let data: { errcode?: unknown; errmsg?: unknown } | null = null;
  try {
    data = (await res.json()) as { errcode?: unknown; errmsg?: unknown };
  } catch {
    data = null;
  }
  if (typeof data?.errcode === "number" && data.errcode === 0) {
    return { ok: true, errcode: 0, errmsg: typeof data.errmsg === "string" ? data.errmsg : "ok" };
  }
  const errcode = typeof data?.errcode === "number" ? data.errcode : -1;
  const errmsg = typeof data?.errmsg === "string" ? data.errmsg : "HTTP " + String(res.status);
  throw new DingTalkSendError(errcode, errmsg);
}

/** actionCard（酷卡片）消息体——群机器人标准卡片，无需应用凭据，仅 webhook(+secret) */
export interface DingTalkActionCardBody {
  msgtype: "actionCard";
  actionCard: {
    title: string;
    text: string;
    btnOrientation: "1"; // 竖向排列按钮
    btns: Array<{ title: string; actionURL: string }>;
  };
}
