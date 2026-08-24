"use client";

/**
 * Phase 2C — Customer Pool 详情（基本信息 + 规则 + 条目 + claim/手工入池）
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";

interface PoolDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  scopeType: string;
  scopeValue: string | null;
  isActive: boolean;
  version: number;
  rules: { id: string; ruleType: string; matchMode: string; condition: unknown; priority: number; isActive: boolean }[];
}

interface EntryRow {
  id: string;
  status: string;
  enteredAt: string;
  enterReason: string;
  businessPartner: { id: string; code: string; name: string; type: string };
  ownerships: { ownerId: string; claimedAt: string; owner: { id: string; name: string | null; email: string | null } }[];
}

const SCOPE_LABELS: Record<string, string> = { GLOBAL: "全局", REGION: "区域", DEPARTMENT: "部门" };
const STATUS_LABELS: Record<string, string> = { IN_POOL: "在公海", CLAIMED: "已被挑入", RELEASED: "已移出" };
const ENTER_REASON_LABELS: Record<string, string> = { MANUAL: "手工", FIELD_RULE: "规则自动", RE_ENTER: "重新入池" };

function PoolDetailPage() {
  const params = useParams();
  const router = useRouter();
  const poolId = typeof params.id === "string" ? params.id : "";

  const [pool, setPool] = useState<PoolDetail | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 新增规则
  const [ruleMatchMode, setRuleMatchMode] = useState("ANY");
  const [rulePriority, setRulePriority] = useState("0");
  const [ruleCondition, setRuleCondition] = useState('[{"field":"region","operator":"EQ","value":"华东"}]');

  // 手工入池
  const [partnerIdInput, setPartnerIdInput] = useState("");

  const load = useCallback(() => {
    setError(null);
    apiFetch<PoolDetail>("/api/customer-pools/" + poolId)
      .then(({ data }) => setPool(data))
      .catch((err: unknown) => setError(err instanceof ApiClientError ? err.message : "加载池失败"));
    apiFetch<EntryRow[]>("/api/customer-pools/" + poolId + "/entries?page=1&pageSize=50")
      .then(({ data }) => setEntries(data))
      .catch(() => undefined);
  }, [poolId]);

  useEffect(() => {
    if (poolId) load();
  }, [poolId, load]);

  const addRule = async () => {
    let condition: unknown;
    try {
      condition = JSON.parse(ruleCondition);
    } catch {
      setError("规则 condition 不是合法 JSON");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/customer-pools/" + poolId + "/rules", {
        method: "POST",
        body: JSON.stringify({
          ruleType: "FIELD_MATCH",
          matchMode: ruleMatchMode,
          condition,
          priority: Number(rulePriority) || 0,
        }),
      });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "新增规则失败");
    } finally {
      setBusy(false);
    }
  };

  const addEntry = async () => {
    if (!partnerIdInput.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/customer-pools/" + poolId + "/entries", {
        method: "POST",
        body: JSON.stringify({ businessPartnerId: partnerIdInput.trim() }),
      });
      setPartnerIdInput("");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "入池失败");
    } finally {
      setBusy(false);
    }
  };

  const claimEntry = async (entry: EntryRow) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/customer-pools/" + poolId + "/entries/" + entry.id + "/claim", {
        method: "POST",
        body: JSON.stringify({}),
      });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "挑入失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppPage title={pool ? pool.name : "公海池详情"} description={pool ? pool.code + " · " + (SCOPE_LABELS[pool.scopeType] ?? pool.scopeType) + (pool.scopeValue ? "：" + pool.scopeValue : "") : "加载中…"}>
      <div className="space-y-4">
        {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {/* 规则区 */}
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-primary">流公海规则（FIELD_MATCH）</h2>
          <ul className="space-y-1 text-sm">
            {pool?.rules.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-xs">
                <span className="rounded bg-brand-50 px-1.5 py-0.5 text-brand-700">{r.matchMode}</span>
                <span className="font-mono text-ink-muted">{JSON.stringify(r.condition)}</span>
                <span>priority={r.priority}</span>
                {!r.isActive && <span className="text-ink-muted">（已停用）</span>}
              </li>
            ))}
            {pool && pool.rules.length === 0 && <li className="text-sm text-ink-muted">暂无规则。</li>}
          </ul>
          <PermissionGuard permission={actionPermission("customer-pool", "edit")}>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
              <select value={ruleMatchMode} onChange={(e) => setRuleMatchMode(e.target.value)} className={INPUT_CLASS}>
                <option value="ANY">ANY（任一命中）</option>
                <option value="ALL">ALL（全部命中）</option>
              </select>
              <input value={rulePriority} onChange={(e) => setRulePriority(e.target.value)} className={INPUT_CLASS} placeholder="priority" />
              <input
                value={ruleCondition}
                onChange={(e) => setRuleCondition(e.target.value)}
                className={INPUT_CLASS + " md:col-span-2"}
                placeholder='[{"field":"region","operator":"EQ","value":"华东"}]'
              />
            </div>
            <button onClick={addRule} disabled={busy} className={BUTTON_PRIMARY_CLASS + " mt-2"}>
              新增规则
            </button>
          </PermissionGuard>
        </section>

        {/* 条目区 */}
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-primary">池条目</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-ink-muted">
                <th className="px-2 py-2">客户</th>
                <th className="px-2 py-2">状态</th>
                <th className="px-2 py-2">入池时间/方式</th>
                <th className="px-2 py-2">当前负责人</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="px-2 py-2">
                    <button className="text-brand-600 hover:underline" onClick={() => router.push("/business-partners/" + e.businessPartner.id)}>
                      {e.businessPartner.name}
                    </button>
                    <span className="ml-1 text-xs text-ink-muted">（{e.businessPartner.code}）</span>
                  </td>
                  <td className="px-2 py-2">{STATUS_LABELS[e.status] ?? e.status}</td>
                  <td className="px-2 py-2 text-xs text-ink-muted">
                    {formatDate(e.enteredAt)} · {ENTER_REASON_LABELS[e.enterReason] ?? e.enterReason}
                  </td>
                  <td className="px-2 py-2 text-xs">{e.ownerships[0]?.owner.name ?? "—"}</td>
                  <td className="px-2 py-2 text-right">
                    {e.status === "IN_POOL" && (
                      <PermissionGuard permission={actionPermission("customer-pool", "assign")}>
                        <button onClick={() => claimEntry(e)} disabled={busy} className={BUTTON_SECONDARY_CLASS + " text-xs"}>
                          挑入
                        </button>
                      </PermissionGuard>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && <p className="mt-2 text-sm text-ink-muted">暂无条目。</p>}
          <PermissionGuard permission={actionPermission("customer-pool", "assign")}>
            <div className="mt-3 flex gap-2">
              <input
                value={partnerIdInput}
                onChange={(e) => setPartnerIdInput(e.target.value)}
                className={INPUT_CLASS}
                placeholder="BusinessPartner ID（手工入池）"
              />
              <button onClick={addEntry} disabled={busy || !partnerIdInput.trim()} className={BUTTON_PRIMARY_CLASS}>
                手工入池
              </button>
            </div>
          </PermissionGuard>
        </section>
      </div>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("customer-pool", "view")}>
      <PoolDetailPage />
    </PermissionGuard>
  );
}
