import { describeStatus, type ApiClientError } from "@/lib/api-client";

/**
 * Track A Frontend Iteration 1 — 列表三态（Loading / Empty / Error）横切组件（Reference 实现）
 * ErrorRow 消费结构化 ApiClientError（status/code/message），按 HTTP 状态分类展示。
 */
export function LoadingRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-ink-muted">
        加载中…
      </td>
    </tr>
  );
}

export function EmptyRow({ colSpan, message = "暂无数据" }: { colSpan: number; message?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-ink-muted">
        {message}
      </td>
    </tr>
  );
}

export function ErrorRow({
  colSpan,
  error,
  onRetry,
}: {
  colSpan: number;
  error: ApiClientError;
  onRetry: () => void;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center">
        <p className="text-sm text-status-danger-text">
          {describeStatus(error.status)}：{error.message}
          {error.code ? `（${error.code}）` : ""}
        </p>
        {error.requestId && (
          <p className="mt-1 text-xs text-ink-muted">requestId: {error.requestId}</p>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="border-border text-ink-secondary mt-2 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-slate-100"
        >
          重试
        </button>
      </td>
    </tr>
  );
}