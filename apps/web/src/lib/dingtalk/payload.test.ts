import { describe, it, expect } from "vitest";
import {
  buildCheckInCard,
  buildOrderStageCard,
  orderStageLabel,
  formatBeijingTime,
  formatAmount,
  coordinateSummary,
  isDingTalkEventType,
} from "./payload";

describe("payload — DingTalk 酷卡片构造（Migration 0055）", () => {
  it("isDingTalkEventType 只认两类事件", () => {
    expect(isDingTalkEventType("CRM_CHECK_IN")).toBe(true);
    expect(isDingTalkEventType("ORDER_STAGE_CHANGED")).toBe(true);
    expect(isDingTalkEventType("SalesOrderConfirmed")).toBe(false);
  });

  it("orderStageLabel 中文映射", () => {
    expect(orderStageLabel("CONFIRMED")).toBe("已确认");
    expect(orderStageLabel("DISPATCHED")).toBe("已发运");
    expect(orderStageLabel("PARTIALLY_DELIVERED")).toBe("部分交付");
    expect(orderStageLabel("DELIVERED")).toBe("已交付");
    expect(orderStageLabel("UNKNOWN")).toBe("UNKNOWN");
  });

  it("签到卡片：客户/签到人/时间/经纬度摘要/距离/跟进摘要 + Customer 360 deep link", () => {
    const body = buildCheckInCard(
      {
        businessPartnerId: "bp-1",
        customerName: "上海示例客户",
        actorId: "u-1",
        actorName: "张三",
        checkinAt: "2026-09-02T05:30:00.000Z",
        latitude: 31.230416,
        longitude: 121.473701,
        distanceMeters: 120,
        locationNote: "客户会议室",
        followUpSummary: "签到：2026-09-02T05:30:00.000Z（客户会议室）",
        channelKey: "sales-group",
      },
      "https://app.example.com",
    );
    expect(body.msgtype).toBe("actionCard");
    expect(body.actionCard.title).toContain("上海示例客户");
    expect(body.actionCard.text).toContain("张三");
    expect(body.actionCard.text).toContain("31.2304"); // 经纬度摘要 4 位小数（非精确定位）
    expect(body.actionCard.text).toContain("120 米");
    expect(body.actionCard.text).toContain("客户会议室");
    expect(body.actionCard.text).toContain("签到：");
    expect(body.actionCard.btns[0].actionURL).toBe("https://app.example.com/business-partners/bp-1");
  });

  it("订单阶段卡片：订单号/客户/阶段/金额/更新时间/责任人 + SalesOrder deep link", () => {
    const body = buildOrderStageCard(
      {
        salesOrderId: "so-1",
        salesOrderCode: "SO-2026-0001",
        customerId: "bp-1",
        customerName: "上海示例客户",
        stage: "DELIVERED",
        stageLabel: "已交付",
        totalAmount: "123456.78",
        currency: "CNY",
        updatedAt: "2026-09-02T06:00:00.000Z",
        ownerId: "u-2",
        ownerName: "李四",
        channelKey: "sales-group",
      },
      "https://app.example.com",
    );
    expect(body.actionCard.title).toContain("SO-2026-0001");
    expect(body.actionCard.title).toContain("已交付");
    expect(body.actionCard.text).toContain("上海示例客户");
    expect(body.actionCard.text).toContain("已交付");
    expect(body.actionCard.text).toContain("CNY");
    expect(body.actionCard.text).toContain("李四");
    expect(body.actionCard.btns[0].actionURL).toBe("https://app.example.com/sales/orders/so-1");
  });

  it("formatBeijingTime：UTC ISO → 北京时间可读", () => {
    const t = formatBeijingTime("2026-09-02T00:30:00.000Z");
    expect(t).toContain("2026"); // Asia/Shanghai = UTC+8 → 09-02 08:30
    expect(t).toContain("08:30");
  });

  it("formatAmount：服务端 Decimal 串 → 货币格式化；非法回退", () => {
    expect(formatAmount("123456.78", "CNY")).toContain("123,456.78");
    expect(formatAmount("abc", "CNY")).toBe("CNY abc");
  });

  it("coordinateSummary：4 位小数；非法输入 → null", () => {
    expect(coordinateSummary(31.230416, 121.473701)).toBe("31.2304, 121.4737");
    expect(coordinateSummary(null, null)).toBeNull();
  });
});
