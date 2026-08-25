/**
 * 拜访/签到地理与时间范围辅助（feat(crm) 拜访周/月视图 + 签到规则 MVP，Migration 0051）
 *
 * - haversineMeters：Haversine 球面距离（米）。签到范围 Gate 只信服务端计算，
 *   不信任客户端自报距离（红线：客户端提供的 canonical/business facts 一律不信任）。
 * - chinaTimeRange：周/月视图边界（Asia/Shanghai = UTC+8 固定无 DST）。
 *   拜访计划按自然日（周=周一 00:00 至下周一 00:00；月=1 号 00:00 至下月 1 号 00:00）。
 */

/** Haversine 距离（米，整数）。参数为经纬度数值（纬度 -90..90，经度 -180..180）。 */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // 地球平均半径（米）
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * 当前周/月视图边界（北京时间 UTC+8；返回 UTC Date，直接与 planDate 比较）。
 * range = "week" → [本周一 00:00, 下周一 00:00)；"month" → [本月 1 号 00:00, 下月 1 号 00:00)。
 */
export function chinaTimeRange(range: "week" | "month"): { start: Date; end: Date } {
  const CN_OFFSET_MS = 8 * 3600 * 1000;
  const now = new Date();
  const cnNow = new Date(now.getTime() + CN_OFFSET_MS); // 北京时间（按 UTC 字段读取）
  const year = cnNow.getUTCFullYear();
  const month = cnNow.getUTCMonth();
  const date = cnNow.getUTCDate();
  const day = cnNow.getUTCDay(); // 0=周日 .. 6=周六

  let startCN: Date;
  let endCN: Date;
  if (range === "week") {
    const daysSinceMonday = (day + 6) % 7;
    startCN = new Date(Date.UTC(year, month, date - daysSinceMonday));
    endCN = new Date(startCN.getTime() + 7 * 24 * 3600 * 1000);
  } else {
    startCN = new Date(Date.UTC(year, month, 1));
    endCN = new Date(Date.UTC(year, month + 1, 1));
  }
  return { start: new Date(startCN.getTime() - CN_OFFSET_MS), end: new Date(endCN.getTime() - CN_OFFSET_MS) };
}
