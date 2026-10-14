/**
 * 物料类型（ItemType）——手动输入的支持代码（物品管理改造 2026-09-27）
 *
 * 背景：用户指令「类型改为手动输入」。Item.itemType 是 **DB 枚举**（10 值），
 * 因此“手动输入”在**不改 Schema** 的前提下实现为：文本输入 + 候选（datalist），
 * 提交前把输入归一化为枚举码（接受枚举码本身或中文业务名，忽略大小写与首尾空格）；
 * 无法识别 → **阻止提交并明确提示**，绝不静默改写用户输入（禁止 silent degradation）。
 *
 * 若将来需要“任意新类型”（枚举 → 自由文本），属 Schema/Migration 变更，需单独 Design/Scope Gate。
 */

export interface ItemTypeOption {
  value: string;
  label: string;
}

/** 与 Prisma 枚举 ItemType 一一对应（顺序即候选顺序） */
export const ITEM_TYPE_OPTIONS: readonly ItemTypeOption[] = [
  { value: "FINISHED_GOOD", label: "成品" },
  { value: "RAW_MATERIAL", label: "原材料" },
  { value: "SEMI_FINISHED", label: "半成品" },
  { value: "PURCHASED_PART", label: "外购件" },
  { value: "ACCESSORY", label: "配件" },
  { value: "SERVICE", label: "服务" },
  { value: "CONSUMABLE", label: "消耗品" },
  { value: "ASSET", label: "资产" },
  { value: "TOOLING", label: "工装" },
  { value: "PACKAGING", label: "包装物" },
] as const;

export const ITEM_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  ITEM_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

/** 输入提示（失败文案与占位符共用，避免两处各写一份） */
export const ITEM_TYPE_INPUT_HINT = ITEM_TYPE_OPTIONS.map((o) => o.label).join(" / ");

/**
 * 手动输入的物料类型 → 规范枚举码。
 * 接受：枚举码（大小写不敏感）｜中文业务名（去空格）。
 * 返回 null 表示无法识别（调用方必须报错，不得回退为空值或默认值）。
 */
export function normalizeItemTypeInput(raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;
  const upper = input.toUpperCase();
  const byValue = ITEM_TYPE_OPTIONS.find((o) => o.value === upper);
  if (byValue) return byValue.value;
  const byLabel = ITEM_TYPE_OPTIONS.find((o) => o.label === input);
  if (byLabel) return byLabel.value;
  return null;
}

/** 展示用：枚举码 → 中文业务名（未知值原样返回，不隐藏真实数据） */
export function itemTypeLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return ITEM_TYPE_LABELS[code] ?? code;
}
