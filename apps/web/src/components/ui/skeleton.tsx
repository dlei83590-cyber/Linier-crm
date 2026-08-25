/**
 * Skeleton — 骨架屏（Sprint8 U2.2 / FE 2.0 UI-01 升级）
 * shimmer 动画见 globals.css（.animate-shimmer）；用于列表/表单/详情加载态。
 * 新增：SkeletonText / SkeletonCircle 便捷变体（保持既有导出签名不变）。
 */
'use client';

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-shimmer rounded-md bg-slate-200/80 ${className}`} aria-hidden="true" />;
}

/** 文本骨架（宽度百分比） */
export function SkeletonText({ width = "w-24", className = "" }: { width?: string; className?: string }) {
  return <Skeleton className={`h-4 ${width} ${className}`} />;
}

/** 圆形骨架（头像/图标位） */
export function SkeletonCircle({ size = "h-8 w-8", className = "" }: { size?: string; className?: string }) {
  return <Skeleton className={`rounded-full ${size} ${className}`} />;
}

/** 按钮骨架 */
export function SkeletonButton({ className = "" }: { className?: string }) {
  return <Skeleton className={`h-10 w-24 ${className}`} />;
}

/** 行内按钮 loading 转圈（Sprint8 U2.4） */
/** 页面级加载骨架（表单/详情页 loading 分支统一复用，替换「加载中…」文本） */
export function PageLoading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

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
