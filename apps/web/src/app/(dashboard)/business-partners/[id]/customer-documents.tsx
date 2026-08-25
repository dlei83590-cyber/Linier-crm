"use client";

/**
 * Phase 3 MVP — Customer 360「文档」Tab（FE 2.0：三态统一 + ConfirmActionDialog + DataTable）
 *
 * 数据：GET/POST /api/business-partners/:id/attachments + DELETE /:id/attachments/:attachmentId
 * 文件元数据：POST /api/files（file:create；FileAttachment businessType="business-partner" 零新表）
 * 权限：列表 file-attachment:view；新增 file-attachment:create；解除 file-attachment:delete
 * 解除挂载：window.confirm → ConfirmActionDialog。
 * HOLD：真实二进制存储/预览下载（附件系统重建）/文档管理平台
 */
import { useCallback, useEffect, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { ConfirmActionDialog } from "@/components/workspace";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { INPUT_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";
import { DataTable, type DataTableColumn } from "./data-table";
import { IconAlertCircle, IconRefreshCw } from "./icons";

interface AttachmentRow {
  id: string;
  attachmentType: string | null;
  createdAt: string;
  file: { id: string; name: string; originalName: string | null; extension: string | null; mimeType: string | null; size: number };
}

const ATTACHMENT_TYPE_LABELS: Record<string, string> = {
  DRAWING: "图纸",
  CERTIFICATE: "证书",
  PHOTO: "照片",
  MANUAL: "手册",
  MODEL_3D: "3D模型",
  VIDEO: "视频",
  INSPECTION_REPORT: "检验报告",
};

function formatSize(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

export function CustomerDocuments({ partnerId }: { partnerId: string }) {
  const [items, setItems] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  // 新增表单（创建文件元数据 → 挂载到客户）
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [attachmentType, setAttachmentType] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<AttachmentRow[]>("/api/business-partners/" + partnerId + "/attachments?page=1&pageSize=50")
      .then(({ data }) => setItems(data))
      .catch((err: unknown) => setError(err instanceof ApiClientError ? err.message : "加载文档失败"))
      .finally(() => setLoading(false));
  }, [partnerId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!name.trim() || !code.trim()) {
      setError("文件名与文件编码必填");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 1) 创建文件元数据（File Center）
      const fileRes = await apiFetch<{ id: string }>("/api/files", {
        method: "POST",
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          originalName: originalName.trim() || undefined,
        }),
      });
      const fileId = fileRes.data.id;
      // 2) 挂载到客户（FileAttachment businessType=business-partner）
      await apiFetch("/api/business-partners/" + partnerId + "/attachments", {
        method: "POST",
        body: JSON.stringify({ fileId, attachmentType: attachmentType || undefined }),
      });
      setName("");
      setCode("");
      setOriginalName("");
      setAttachmentType("");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const runRemove = async () => {
    if (!confirmTarget || removeBusy) return;
    setRemoveBusy(true);
    try {
      await apiFetch("/api/business-partners/" + partnerId + "/attachments/" + confirmTarget.id, { method: "DELETE" });
      setConfirmTarget(null);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "删除失败");
      setConfirmTarget(null);
    } finally {
      setRemoveBusy(false);
    }
  };

  const columns: DataTableColumn<AttachmentRow>[] = [
    { key: "name", header: "文件名", render: (r) => (
      <span>
        {r.file.name}
        {r.file.originalName && r.file.originalName !== r.file.name ? (
          <span className="ml-1 text-xs text-ink-muted">（{r.file.originalName}）</span>
        ) : null}
      </span>
    ) },
    { key: "type", header: "类型", render: (r) => r.attachmentType ? (ATTACHMENT_TYPE_LABELS[r.attachmentType] ?? r.attachmentType) : "—" },
    { key: "size", header: "大小", align: "right", render: (r) => <span className="tabular-nums">{formatSize(r.file.size)}</span> },
    { key: "createdAt", header: "挂载时间", render: (r) => formatDate(r.createdAt) },
    { key: "actions", header: "", render: (r) => (
      <PermissionGuard permission={actionPermission("file-attachment", "delete")}>
        <button
          type="button"
          onClick={() => setConfirmTarget({ id: r.id, name: r.file.name })}
          className={BUTTON_SECONDARY_CLASS + " text-xs"}
        >
          解除挂载
        </button>
      </PermissionGuard>
    ) },
  ];

  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-elevation-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-primary">客户文档</h2>
        {!loading && !error && <span className="text-xs text-ink-muted">共 {items.length} 个</span>}
      </div>
      <p className="mb-3 text-xs text-ink-muted">文档复用 File Center（元数据；真实二进制存储/预览下载后续接入对象存储）。</p>
      {error && <p className="mb-3 text-xs text-status-danger-text">{error}</p>}

      <PermissionGuard permission={actionPermission("file-attachment", "create")}>
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-canvas/50 p-3">
          <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLASS + " max-w-xs"} placeholder="文件名（必填）" />
          <input value={code} onChange={(e) => setCode(e.target.value)} className={INPUT_CLASS + " max-w-xs"} placeholder="文件编码（唯一，必填）" />
          <input value={originalName} onChange={(e) => setOriginalName(e.target.value)} className={INPUT_CLASS + " max-w-xs"} placeholder="原始文件名（可选）" />
          <select value={attachmentType} onChange={(e) => setAttachmentType(e.target.value)} className={INPUT_CLASS + " max-w-xs"}>
            <option value="">类型（可选）</option>
            {Object.entries(ATTACHMENT_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button onClick={submit} disabled={busy} className={BUTTON_PRIMARY_CLASS + " text-xs"}>
            登记文档
          </button>
        </div>
      </PermissionGuard>

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-status-danger-border bg-status-danger-bg/30 py-8 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-status-danger-bg text-status-danger-text">
            <IconAlertCircle className="h-5 w-5" />
          </span>
          <p className="text-sm text-status-danger-text">{error}</p>
          <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-slate-50">
            <IconRefreshCw className="h-3.5 w-3.5" />
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="暂无文档" description="登记文件元数据并挂载到客户；文件本体保留在 File Center。" />
      ) : (
        <DataTable columns={columns} rows={items} rowKey={(r) => r.id} />
      )}

      <ConfirmActionDialog
        open={confirmTarget !== null}
        title={"解除文档挂载「" + (confirmTarget?.name ?? "") + "」？"}
        description="解除后该文档不再展示在客户文档列表（文件本身保留在 File Center）。"
        confirmLabel="解除挂载"
        tone="danger"
        busy={removeBusy}
        onConfirm={runRemove}
        onCancel={() => setConfirmTarget(null)}
      />
    </section>
  );
}
