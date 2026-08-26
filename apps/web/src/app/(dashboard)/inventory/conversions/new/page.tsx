"use client";

/**
 * Inventory Conversion Create — 新建库存转换单（F2-6B 批 3 + UI-09 FE2.0 表单统一）
 *
 * 契约：POST /api/inventory-conversions（inventory-conversion:create），创建即取号 CVT。
 * 同一 itemId；恰好 1 CONSUME + 1 PRODUCE；baseQuantity 服务端计算（前端只提交 quantity + uomToBaseRate）。
 * baseUomId 必须 == item.stockUomId（选择物料自动带出）。
 * PermissionGuard 对齐 API requirePermission("inventory-conversion:create")。
 *
 * UI-09：迁移至 EntityFormWorkspace（Dirty-State Guard / 409 冲突面板 / ErrorPanel /
 * 统一 Save/Cancel），移除页面级 window.confirm；数字列右对齐 tabular-nums。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { FormField } from "@/components/ui/form-field";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface ItemOption { id: string; code: string | null; name: string | null; stockUom?: { id: string; code: string | null; symbol: string | null } | null }
interface UomOption { id: string; code: string | null; symbol: string | null }
interface WarehouseOption { id: string; code: string | null; name: string | null }
interface LocationOption { id: string; code: string | null; name: string | null }

interface LineForm {
  quantity: string;
  uomId: string;
  uomToBaseRate: string;
  warehouseId: string;
  locationId: string;
  batchNo: string;
}

const EMPTY_LINE: LineForm = { quantity: "", uomId: "", uomToBaseRate: "1", warehouseId: "", locationId: "", batchNo: "" };

function ConversionCreateForm() {
  const router = useRouter();
  const [items, setItems] = useState<ItemOption[]>([]);
  const [uoms, setUoms] = useState<UomOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [itemId, setItemId] = useState("");
  const [baseUomId, setBaseUomId] = useState("");
  const [remark, setRemark] = useState("");
  const [consume, setConsume] = useState<LineForm>({ ...EMPTY_LINE });
  const [produce, setProduce] = useState<LineForm>({ ...EMPTY_LINE });
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<ItemOption[]>("/api/items?pageSize=100", { signal: controller.signal }),
      apiFetch<UomOption[]>("/api/unit-of-measures?pageSize=100", { signal: controller.signal }),
      apiFetch<WarehouseOption[]>("/api/warehouses?pageSize=100", { signal: controller.signal }),
      apiFetch<LocationOption[]>("/api/warehouse-locations?pageSize=100", { signal: controller.signal }),
    ])
      .then(([it, u, w, l]) => {
        setItems(it.data);
        setUoms(u.data);
        setWarehouses(w.data);
        setLocations(l.data);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "加载基础数据失败", "NETWORK_ERROR"),
        );
      });
    return () => controller.abort();
  }, []);

  const markDirty = () => setDirty(true);

  const handleItemChange = (id: string) => {
    const item = items.find((it) => it.id === id);
    setItemId(id);
    setBaseUomId(item?.stockUom?.id ?? "");
    markDirty();
  };

  const updateLine = (role: "consume" | "produce", patch: Partial<LineForm>) => {
    const setter = role === "consume" ? setConsume : setProduce;
    setter((prev) => ({ ...prev, ...patch }));
    markDirty();
  };

  const validateLine = (line: LineForm, prefix: string): boolean => {
    const errs: Record<string, string> = {};
    if (!line.quantity || Number(line.quantity) <= 0) errs[`${prefix}.quantity`] = "数量必须大于 0";
    if (!line.uomId) errs[`${prefix}.uomId`] = "请选择业务单位";
    if (!line.uomToBaseRate || Number(line.uomToBaseRate) <= 0) errs[`${prefix}.rate`] = "换算率必须大于 0";
    if (!line.warehouseId) errs[`${prefix}.warehouseId`] = "请选择仓库";
    setFieldErrors((prev) => ({ ...prev, ...errs }));
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    const errs: Record<string, string> = {};
    if (!itemId) errs.itemId = "请选择物料";
    if (!baseUomId) errs.baseUomId = "物料缺少库存基准单位";
    setFieldErrors(errs);
    const consumeOk = validateLine(consume, "consume");
    const produceOk = validateLine(produce, "produce");
    if (Object.keys(errs).length > 0 || !consumeOk || !produceOk) return;

    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        itemId,
        baseUomId,
        ...(remark.trim() ? { remark: remark.trim() } : {}),
        lines: [
          {
            lineRole: "CONSUME",
            quantity: Number(consume.quantity),
            uomId: consume.uomId,
            uomToBaseRate: Number(consume.uomToBaseRate),
            warehouseId: consume.warehouseId,
            ...(consume.locationId ? { locationId: consume.locationId } : {}),
            ...(consume.batchNo.trim() ? { batchNo: consume.batchNo.trim() } : {}),
          },
          {
            lineRole: "PRODUCE",
            quantity: Number(produce.quantity),
            uomId: produce.uomId,
            uomToBaseRate: Number(produce.uomToBaseRate),
            warehouseId: produce.warehouseId,
            ...(produce.locationId ? { locationId: produce.locationId } : {}),
            ...(produce.batchNo.trim() ? { batchNo: produce.batchNo.trim() } : {}),
          },
        ],
      };
      const body = await apiFetch<{ id: string }>("/api/inventory-conversions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDirty(false);
      router.push(`/inventory/conversions/${body.data.id}`);
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "创建失败", "NETWORK_ERROR"),
      );
      setSubmitting(false);
    }
  };

  const renderLine = (role: "consume" | "produce", line: LineForm, title: string) => (
    <section className="rounded-md border border-border p-4">
      <h3 className="text-ink-primary mb-3 text-sm font-semibold">{title}</h3>
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <FormField label="数量" required>
          <input
            type="number" min="0" step="any" value={line.quantity}
            onChange={(e) => updateLine(role, { quantity: e.target.value })}
            className={`${INPUT_CLASS} tabular-nums`}
          />
          {fieldErrors[`${role}.quantity`] ? (
            <span className="text-xs text-status-danger-text">{fieldErrors[`${role}.quantity`]}</span>
          ) : null}
        </FormField>
        <FormField label="业务单位" required>
          <select
            value={line.uomId}
            onChange={(e) => updateLine(role, { uomId: e.target.value })}
            className={INPUT_CLASS}
          >
            <option value="">选择单位</option>
            {uoms.map((u) => (
              <option key={u.id} value={u.id}>{u.symbol ?? u.code ?? "未命名单位"}</option>
            ))}
          </select>
          {fieldErrors[`${role}.uomId`] ? (
            <span className="text-xs text-status-danger-text">{fieldErrors[`${role}.uomId`]}</span>
          ) : null}
        </FormField>
        <FormField label="换算率（业务→基准）" required>
          <input
            type="number" min="0" step="any" value={line.uomToBaseRate}
            onChange={(e) => updateLine(role, { uomToBaseRate: e.target.value })}
            className={`${INPUT_CLASS} tabular-nums`}
          />
          {fieldErrors[`${role}.rate`] ? (
            <span className="text-xs text-status-danger-text">{fieldErrors[`${role}.rate`]}</span>
          ) : null}
        </FormField>
        <FormField label="仓库" required>
          <select
            value={line.warehouseId}
            onChange={(e) => updateLine(role, { warehouseId: e.target.value })}
            className={INPUT_CLASS}
          >
            <option value="">选择仓库</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.code ?? ""} {w.name ?? ""}</option>
            ))}
          </select>
          {fieldErrors[`${role}.warehouseId`] ? (
            <span className="text-xs text-status-danger-text">{fieldErrors[`${role}.warehouseId`]}</span>
          ) : null}
        </FormField>
        <FormField label="库位（可选）">
          <select
            value={line.locationId}
            onChange={(e) => updateLine(role, { locationId: e.target.value })}
            className={INPUT_CLASS}
          >
            <option value="">未指定</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.code ?? ""} {l.name ?? ""}</option>
            ))}
          </select>
        </FormField>
        <FormField label="批次（可选）">
          <input
            value={line.batchNo}
            onChange={(e) => updateLine(role, { batchNo: e.target.value })}
            maxLength={100}
            className={INPUT_CLASS}
          />
        </FormField>
      </div>
    </section>
  );

  return (
    <EntityFormWorkspace
      title="新建库存转换单"
      description="同一物料 Repack / UOM 转换：恰好 1 消耗（CONSUME）+ 1 产出（PRODUCE），守恒校验由后端执行。"
      backHref="/inventory/conversions"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSubmit}
      onCancel={() => router.push("/inventory/conversions")}
      saveLabel="创建（草稿）"
    >
      <section className="rounded-md border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-primary">转换信息</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField label="物料" required hint="同一物料，Repack / UOM 转换">
            <select
              value={itemId}
              onChange={(e) => handleItemChange(e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">选择物料</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>{it.code ?? ""} {it.name ?? ""}</option>
              ))}
            </select>
            {fieldErrors.itemId ? (
              <span className="text-xs text-status-danger-text">{fieldErrors.itemId}</span>
            ) : null}
          </FormField>
          <div>
            <span className="text-sm font-medium text-ink-secondary">基准单位（自动）</span>
            <p className="mt-2 text-sm text-ink-secondary">
              {baseUomId ? (items.find((it) => it.id === itemId)?.stockUom?.symbol ?? baseUomId) : "—"}
            </p>
            {fieldErrors.baseUomId ? (
              <span className="text-xs text-status-danger-text">{fieldErrors.baseUomId}</span>
            ) : null}
          </div>
          <FormField label="备注（可选，≤500）">
            <input
              value={remark}
              onChange={(e) => { setRemark(e.target.value); markDirty(); }}
              maxLength={500}
              className={INPUT_CLASS}
            />
          </FormField>
        </div>
      </section>

      {renderLine("consume", consume, "消耗（CONSUME）")}
      {renderLine("produce", produce, "产出（PRODUCE）")}
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("inventory-conversion", "create")}>
      <AppPage>
        <ConversionCreateForm />
      </AppPage>
    </PermissionGuard>
  );
}
