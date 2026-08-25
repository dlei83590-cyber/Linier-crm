/**
 * FRT-08 Inventory Runtime — 调拨表单纯函数
 *
 * 与 create / edit 表单共享的纯逻辑（无 React/网络依赖，可单测）：
 * - filterLocationsByWarehouse：库位下拉按所选仓库过滤（真实 selector，禁 raw FK ID 输入）
 * - splitSerialNos：序列号逗号分隔输入 → 数组（去空白/去空项）
 */
export interface WarehouseLocationLike {
  id: string;
  warehouseId?: string | null;
}

/** 按仓库过滤库位；未选仓库时返回全部（表单默认"未指定"空值由调用方处理）。 */
export function filterLocationsByWarehouse<T extends WarehouseLocationLike>(
  locations: T[],
  warehouseId: string,
): T[] {
  if (!warehouseId) return locations;
  return locations.filter((l) => l.warehouseId === warehouseId);
}

/** "SN1, SN2,SN3" → ["SN1","SN2","SN3"]；空输入 → []。 */
export function splitSerialNos(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
