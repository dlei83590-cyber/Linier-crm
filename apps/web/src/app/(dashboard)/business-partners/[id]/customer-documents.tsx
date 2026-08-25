"use client";

/**
 * Phase 3 MVP — Customer 360「文档」Tab（客户文档/附件，复用 File Center）
 *
 * 数据：GET/POST /api/business-partners/:id/attachments + DELETE /:id/attachments/:attachmentId
 * 文件元数据：POST /api/files（file:create；FileAttachment businessType="business-partner" 零新表）
 * 权限：列表 file-attachment:view；新增 file-attachment:create；解除 file-attachment:delete
 * HOLD：真实二进制存储/预览下载（附件系统重建）/文档管理平台
 */
import { useCallback, useEffect, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";

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

  // 新增表单（创建文件元数据 → 挂载到客户）
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [attachmentType, setAttachmentType] = useState("");

  const load = useCallback(() => {
    setLoading(true);
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

  const remove = async (id: string) => {
    if (!window.confirm("确认解除该文档挂载？（文件本身保留在 File Center）")) return;
    setError(null);
    try {
      await apiFetch("/api/business-partners/" + partnerId + "/attachments/" + id, { method: "DELETE" });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "删除失败");
    }
  };

  return (
    <section className="rounded-md border border-border p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-primary">客户文档</h2>
      <p className="mb-2 text-xs text-ink-muted">文档复用 File Center（元数据；真实二进制存储/预览下载后续接入对象存储）。</p>
      {error && <p className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      <PermissionGuard permission={actionPermission("file-attachment", "create")}>
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
          <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLASS + " max-w-xs"} placeholder="文件名（必填）" />
          <input value={code} onChange={(e) => setCode(e.target.value)} className={INPUT_CLASS + " max-w-xs"} placeholder="文件编码（唯一，必填）" />
          <input value={originalName} onChange={(e) => setOriginalName(e.target.value)} className={INPUT_CLASS + " max-w-xs"} placeholder="原始文件名（可选）" />
          <select value={attachmentType} onChange={(e) => setAttachmentType(e.target.value)} className={INPUT_CLASS + " max-w-xs"}>
            <option value="">类型（可选）</option>
            {Object.entries(ATTACHMENT_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button onClick={submit} disabled={busy} className={BUTTON_PRIMARY_CLASS + " text-xs"}>
            上传文档
          </button>
        </div>
      </PermissionGuard>

      {loading ? (
        <p className="text-sm text-ink-muted">加载中…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-muted">暂无文档。</p>
      ) : (
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="text-ink-secondary bg-canvas text-left text-xs font-medium">
            <tr>
              <th className="px-4 py-2 font-semibold">文件名</th>
              <th className="px-4 py-2 font-semibold">类型</th>
              <th className="px-4 py-2 font-semibold">大小</th>
              <th className="px-4 py-2 font-semibold">挂载时间</th>
              <th className="px-4 py-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2">
                  {r.file.name}
                  {r.file.originalName && r.file.originalName !== r.file.name ? (
                    <span className="ml-1 text-xs text-ink-muted">（{r.file.originalName}）</span>
                  ) : null}
                </td>
                <td className="px-4 py-2">{r.attachmentType ? (ATTACHMENT_TYPE_LABELS[r.attachmentType] ?? r.attachmentType) : "—"}</td>
                <td className="px-4 py-2 tabular-nums">{formatSize(r.file.size)}</td>
                <td className="px-4 py-2">{formatDate(r.createdAt)}</td>
                <td className="px-4 py-2 text-right">
                  <PermissionGuard permission={actionPermission("file-attachment", "delete")}>
                    <button onClick={() => remove(r.id)} className={BUTTON_SECONDARY_CLASS + " text-xs"}>
                      解除挂载
                    </button>
                  </PermissionGuard>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
