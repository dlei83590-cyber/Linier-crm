/**
 * Customer 360 — Lucide 风格内联图标（FE 2.0）
 *
 * 禁止 emoji 当产品图标；本文件为业务页面局部图标集（当前线范围自持，
 * 不触碰 core design-system / UI-01 独占文件）。如需全站图标体系，
 * 属 DESIGN SYSTEM DELTA（PR body 声明）。
 */
import { activityTypeMeta } from "@/lib/customer/activity-meta";

function IconBase({
  className = "h-4 w-4",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconPhone({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </IconBase>
  );
}

export function IconCalendar({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </IconBase>
  );
}

export function IconMapPin({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </IconBase>
  );
}

export function IconMessageCircle({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </IconBase>
  );
}

export function IconShieldCheck({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </IconBase>
  );
}

export function IconUsers({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </IconBase>
  );
}

export function IconTarget({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </IconBase>
  );
}

export function IconFileText({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </IconBase>
  );
}

export function IconTrendingUp({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="m22 7-8.5 8.5-5-5L2 17" />
      <path d="M16 7h6v6" />
    </IconBase>
  );
}

export function IconClock({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </IconBase>
  );
}

export function IconCheckCircle({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </IconBase>
  );
}

export function IconAlertCircle({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </IconBase>
  );
}

export function IconRefreshCw({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </IconBase>
  );
}

export function IconEllipsis({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M5 12h.01M12 12h.01M19 12h.01" />
    </IconBase>
  );
}

export function IconChevronRight({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="m9 18 6-6-6-6" />
    </IconBase>
  );
}

/** 活动类型 → 图标（时间线节点/摘要徽标；类型未知回退 follow-up 图标） */
export function ActivityTypeIcon({
  type,
  className,
}: {
  type: string | null | undefined;
  className?: string;
}) {
  const meta = activityTypeMeta(type);
  switch (meta.icon) {
    case "visit-plan":
      return <IconCalendar className={className} />;
    case "check-in":
      return <IconMapPin className={className} />;
    case "comment":
      return <IconMessageCircle className={className} />;
    case "approval":
      return <IconShieldCheck className={className} />;
    default:
      return <IconPhone className={className} />;
  }
}
