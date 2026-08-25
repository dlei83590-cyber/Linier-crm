/**
 * Supplier / Item Selector Options — 纯函数（FRT-02 前端生产可操作性）
 *
 * Customer 360「供应商」/「产品」Tab 的 selector 选项构建 SSOT。
 *
 * 红线（禁 raw database ID）：
 *   /api/business-partners/:id/suppliers 的 POST.supplierId 语义 = BusinessPartner.id
 *   （CustomerSupplier.supplier → BusinessPartner，BP-BP 自关联）。
 *   /api/suppliers 返回的 option.id 是 Supplier 表主键（非 BP id），
 *   必须使用 option.partner.id 作为提交值；无 partner 的 Supplier 行无法作为
 *   BusinessPartner 引用 → 一律排除，禁止 `partner?.id ?? option.id` 回退到 raw id。
 *
 * 过滤规则：
 *   - 供应商选项：无 partner 的排除；partner.id === 当前客户自身 排除（后端禁自关联）；
 *     已在关联列表中的（alreadyLinkedBpIds，BP id 集合）排除，避免重复关联 409。
 *   - 产品选项：已关联的 item 排除（避免重复关联 409；解除后重新出现 → 再次关联完整闭环）。
 */
export interface SupplierOptionSource {
  id: string; // Supplier.id（禁止直接作为提交值）
  code: string | null;
  name: string | null;
  partner: { id: string; name: string } | null; // BusinessPartner.id（唯一合法提交值）
}

export interface SupplierOptionView {
  id: string; // BusinessPartner.id
  code: string | null;
  name: string;
  label: string;
}

export interface BuildSupplierOptionsOptions {
  /** 当前客户自身 BusinessPartner.id（排除自关联） */
  excludePartnerId?: string;
  /** 已关联供应商的 BusinessPartner.id 集合（来自 /api/business-partners/:id/suppliers 的 supplier.id） */
  alreadyLinkedBpIds?: string[];
}

export function buildSupplierOptionViews(
  sources: SupplierOptionSource[],
  opts: BuildSupplierOptionsOptions = {},
): SupplierOptionView[] {
  const linked = new Set(opts.alreadyLinkedBpIds ?? []);
  return (sources ?? [])
    .filter((s) => s.partner !== null && s.partner.id !== opts.excludePartnerId && !linked.has(s.partner.id))
    .map((s) => ({
      id: s.partner!.id,
      code: s.code,
      name: s.partner!.name,
      label: [s.code, s.partner!.name].filter(Boolean).join(" — "),
    }));
}

export interface ItemOptionSource {
  id: string; // Item.id（POST /products 的 itemId 语义 = Item.id，合法）
  code: string;
  name: string;
  model: string | null;
}

export interface ItemOptionView {
  id: string;
  label: string;
}

export interface BuildItemOptionsOptions {
  /** 已关联产品的 Item.id 集合（来自 /api/business-partners/:id/products 的 item.id） */
  alreadyLinkedItemIds?: string[];
}

export function buildItemOptionViews(
  sources: ItemOptionSource[],
  opts: BuildItemOptionsOptions = {},
): ItemOptionView[] {
  const linked = new Set(opts.alreadyLinkedItemIds ?? []);
  return (sources ?? [])
    .filter((i) => !linked.has(i.id))
    .map((i) => ({
      id: i.id,
      label: [i.code, i.model ? `${i.name}（${i.model}）` : i.name].filter(Boolean).join(" — "),
    }));
}
