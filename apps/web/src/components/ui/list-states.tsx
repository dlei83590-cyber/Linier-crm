import { describeStatus, type ApiClientError } from "@/lib/api-client";

/**
 * Track A Frontend Iteration 1 — 列表三态（Loading / Empty / Error）横切组件（Reference 实现）
 * ErrorRow 消费结构化 ApiClientError（status/code/message），按 HTTP 状态分类展示。
 */
export function LoadingRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-slate-400">
        加载中…
      </td>
    </tr>
  );
}

export function EmptyRow({ colSpan, message = "暂无数据" }: { colSpan: number; message?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-slate-400">
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
        <p className="text-sm text-red-600">
          {describeStatus(error.status)}：{error.message}
          {error.code ? `（${error.code}）` : ""}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          重试
        </button>
      </td>
    </tr>
  );
}
