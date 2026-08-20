import { describeStatus, type ApiClientError } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Track A Frontend Iteration 1 — 列表三态（Loading / Empty / Error）横切组件
 * Sprint8 U2：LoadingRow → 骨架屏 shimmer；EmptyRow → EmptyState（图标+标题+描述）
 * ErrorRow 消费结构化 ApiClientError（status/code/message），按 HTTP 状态分类展示。
 */
const SKELETON_WIDTHS = ["w-1/4", "w-1/3", "w-1/4", "w-1/6", "w-1/5"];

export function LoadingRow({ colSpan }: { colSpan: number }) {
  return (
    <tr aria-busy="true">
      <td colSpan={colSpan} className="px-4 py-4">
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-4">
              {SKELETON_WIDTHS.map((w, i) => (
                <Skeleton key={i} className={`h-4 ${w}`} />
              ))}
            </div>
          ))}
        </div>
      </td>
    </tr>
  );
}

export function EmptyRow({ colSpan, message = "暂无数据" }: { colSpan: number; message?: string }) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <EmptyState title={message} />
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
