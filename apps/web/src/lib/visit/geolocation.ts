/**
 * 拜访/签到浏览器定位硬化（FRT-04 错误 UX）：
 * - GEOLOCATION_OPTIONS：15s 超时 + 不缓存旧位置 + 高精度。浏览器定位授权弹窗若被忽略，
 *   默认会无限挂起导致「定位签到中…」卡死——必须显式 timeout；maximumAge=0 保证签到用真实当前位置。
 * - geolocationErrorMessage：PositionError.code → 明确用户反馈（PERMISSION_DENIED / POSITION_UNAVAILABLE /
 *   TIMEOUT 三种真实原因区分），禁止把所有失败笼统降级成同一句话、禁止静默失败。
 */

/** getCurrentPosition 定位选项（签到需真实当前位置：高精度 + 15s 超时 + 不缓存） */
export const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0,
};

/**
 * 定位错误码 → 真实用户反馈。
 * @param code PositionError.code：1=PERMISSION_DENIED，2=POSITION_UNAVAILABLE，3=TIMEOUT
 */
export function geolocationErrorMessage(code: number | null | undefined, fallback = "定位失败，请重试"): string {
  switch (code) {
    case 1:
      return "定位权限被拒绝：请在浏览器设置/地址栏允许本网站访问位置后重试";
    case 2:
      return "无法获取当前位置（定位信号不可用），请检查网络或 GPS 后再试";
    case 3:
      return "定位超时（15 秒内未返回位置），请重试";
    default:
      return fallback;
  }
}
