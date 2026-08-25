/**
 * DingTalk 酷卡片载荷构造（合同功能收口：自建消息底座 + 钉钉酷卡片最小接线）
 *
 * 两类领域事件 → actionCard：
 * - CRM_CHECK_IN（签到）：客户 / 签到人 / 时间（北京时间）/ 经纬度摘要（4 位小数，非精确定位）/
 *   距离（服务端 Haversine）/ 跟进摘要 / Customer 360 deep link；
 * - ORDER_STAGE_CHANGED（订单阶段）：订单号 / 客户 / 阶段（from→to）/ 金额 / 更新时间 / 责任人 / SalesOrder deep link。
 *
 * 安全红线：经纬度只出摘要（≈11m 精度），精确定位不进外部渠道；payload 里 channelKey 仅内部路由用。
 */
import type { DingTalkActionCardBody } from "./adapter";
import { absoluteDeepLink } from "./channel-config";

export const DINGTALK_EVENT_TYPES = ["CRM_CHECK_IN", "ORDER_STAGE_CHANGED"] as const;
export type DingTalkEventType = (typeof DINGTALK_EVENT_TYPES)[number];

export function isDingTalkEventType(value: string): value is DingTalkEventType {
  return (DINGTALK_EVENT_TYPES as readonly string[]).includes(value);
}

/** 订单阶段中文标签（状态机红线上屏用业务文案，不做多余翻译表） */
const STAGE_LABELS: Record<string, string> = {
  CONFIRMED: "已确认",
  DISPATCHED: "已发运",
  PARTIALLY_DELIVERED: "部分交付",
  DELIVERED: "已交付",
};

export function orderStageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

/** 北京时间（Asia/Shanghai，UTC+8 固定）格式化，用于卡片可读时间 */
export function formatBeijingTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return typeof iso === "string" ? iso : "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** 金额格式化：优先 Intl 货币，失败回退 "CNY 123.45"（不信任客户端金额，服务端 Decimal toString 传入） */
export function formatAmount(amount: string, currency: string | null | undefined): string {
  const num = Number(amount);
  if (!Number.isFinite(num)) return (currency ?? "CNY") + " " + amount;
  try {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency: currency ?? "CNY", currencyDisplay: "code" }).format(num);
  } catch {
    return (currency ?? "CNY") + " " + amount;
  }
}

/** 经纬度摘要：4 位小数（≈11m），不暴露精确定位；null/undefined/非数值 → null（Number(null)=0 需先行排除） */
export function coordinateSummary(lat: unknown, lng: unknown): string | null {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  return la.toFixed(4) + ", " + ln.toFixed(4);
}

interface CardTextRow {
  label: string;
  value: string;
}

function cardText(rows: CardTextRow[]): string {
  return rows.map((r) => "**" + r.label + "：**" + r.value).join("\n\n");
}

/** 签到卡片（Customer 360 deep link：/business-partners/:id） */
export function buildCheckInCard(payload: Record<string, unknown>, baseUrl: string): DingTalkActionCardBody {
  const customerName = typeof payload.customerName === "string" ? payload.customerName : "—";
  const rows: CardTextRow[] = [
    { label: "客户", value: customerName },
    { label: "签到人", value: typeof payload.actorName === "string" ? payload.actorName : "—" },
    { label: "签到时间", value: typeof payload.checkinAt === "string" ? formatBeijingTime(payload.checkinAt) : "—" },
  ];
  const coord = coordinateSummary(payload.latitude, payload.longitude);
  if (coord) rows.push({ label: "经纬度", value: coord });
  if (typeof payload.distanceMeters === "number" && payload.distanceMeters !== null) {
    rows.push({ label: "距客户", value: payload.distanceMeters + " 米" });
  }
  if (typeof payload.locationNote === "string" && payload.locationNote) {
    rows.push({ label: "位置", value: payload.locationNote });
  }
  if (typeof payload.followUpSummary === "string" && payload.followUpSummary) {
    rows.push({ label: "跟进摘要", value: payload.followUpSummary });
  }
  const id = typeof payload.businessPartnerId === "string" ? payload.businessPartnerId : "";
  return {
    msgtype: "actionCard",
    actionCard: {
      title: "【签到】" + customerName,
      text: cardText(rows),
      btnOrientation: "1",
      btns: [{ title: "查看客户 360", actionURL: absoluteDeepLink(baseUrl, "/business-partners/" + id) }],
    },
  };
}

/** 订单阶段卡片（SalesOrder deep link：/sales/orders/:id） */
export function buildOrderStageCard(payload: Record<string, unknown>, baseUrl: string): DingTalkActionCardBody {
  const orderCode = typeof payload.salesOrderCode === "string" ? payload.salesOrderCode : "—";
  const stage = typeof payload.stage === "string" ? payload.stage : "";
  const stageLabel = typeof payload.stageLabel === "string" ? payload.stageLabel : orderStageLabel(stage);
  const rows: CardTextRow[] = [
    { label: "订单号", value: orderCode },
    { label: "客户", value: typeof payload.customerName === "string" ? payload.customerName : "—" },
    { label: "当前阶段", value: stageLabel },
  ];
  if (typeof payload.totalAmount === "string" && payload.totalAmount) {
    rows.push({ label: "订单金额", value: formatAmount(payload.totalAmount, typeof payload.currency === "string" ? payload.currency : "CNY") });
  }
  if (typeof payload.updatedAt === "string") {
    rows.push({ label: "更新时间", value: formatBeijingTime(payload.updatedAt) });
  }
  if (typeof payload.ownerName === "string" && payload.ownerName) {
    rows.push({ label: "责任人", value: payload.ownerName });
  }
  const id = typeof payload.salesOrderId === "string" ? payload.salesOrderId : "";
  return {
    msgtype: "actionCard",
    actionCard: {
      title: "【订单阶段】" + orderCode + " · " + stageLabel,
      text: cardText(rows),
      btnOrientation: "1",
      btns: [{ title: "查看订单", actionURL: absoluteDeepLink(baseUrl, "/sales/orders/" + id) }],
    },
  };
}
