/**
 * Skeleton — 骨架屏（Sprint8 U2.2）
 * shimmer 动画见 globals.css（.animate-shimmer）；用于列表/表单/详情加载态。
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-shimmer rounded-md bg-slate-200/80 ${className}`} aria-hidden="true" />;
}

/** 行内按钮 loading 转圈（Sprint8 U2.4） */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`h-4 w-4 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}
