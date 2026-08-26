/**
 * Charts — 零依赖自绘 SVG 图表（FE 2.0 UI 补齐）
 *
 * 决策：不引入图表库（CI frozen-lockfile + 包体可控 + 与既有零依赖 SVG 风格一致），
 * 用纯 SVG 实现两类高价值基础图表：
 *  - Sparkline：迷你趋势线（含面积填充），用于仪表盘/报表的同比环比
 *  - Donut：占比环形图（含中心合计插槽），用于商机阶段/订单状态分布
 *
 * 纯展示组件（无 client hook / 无副作用），数据由调用方投影；颜色一律语义类
 * （brand-* / status-* / domain-*），禁止硬编码业务色；prefers-reduced-motion 由 globals.css 统一降级。
 */

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  /** 描边色类（如 stroke-brand-500 / stroke-status-success-text） */
  strokeClass?: string;
  /** 面积填充色类（如 fill-brand-500/10） */
  fillClass?: string;
  /** 显式纵轴范围（缺省取数据 min/max） */
  min?: number;
  max?: number;
  className?: string;
}

/** Sparkline — 迷你趋势线（数据点少于 2 返回 null） */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  strokeClass = "stroke-brand-500",
  fillClass = "fill-brand-500/10",
  min,
  max,
  className = "",
}: SparklineProps) {
  if (data.length < 2) return null;
  const lo = min ?? Math.min(...data);
  const hi = max ?? Math.max(...data);
  const span = hi - lo || 1;
  const stepX = width / (data.length - 1);
  const pad = 2;
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = pad + (1 - (v - lo) / span) * (height - pad * 2);
    return { x, y };
  });
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = [
    `M${points[0].x.toFixed(1)},${height}`,
    `L${line.split(" ").join(" L")}`,
    `L${points[points.length - 1].x.toFixed(1)},${height}`,
    "Z",
  ].join(" ");
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label="趋势图"
    >
      <path d={area} className={fillClass} aria-hidden="true" />
      <polyline
        points={line}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={strokeClass}
        aria-hidden="true"
      />
    </svg>
  );
}

export interface DonutSegment {
  value: number;
  /** 分段色（语义色类对应的实际色值；分段色为展示投影，非业务事实） */
  color: string;
  label?: string;
}

export interface DonutProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  /** 中心合计文案（可选） */
  centerLabel?: string;
  centerValue?: string;
  className?: string;
}

/** Donut — 占比环形图（value 为 0 的分段自动跳过；总值为 0 时渲染空环） */
export function Donut({
  segments,
  size = 120,
  thickness = 14,
  centerLabel,
  centerValue,
  className = "",
}: DonutProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;
  let offset = 0;
  const visible = segments.filter((s) => s.value > 0);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={centerLabel ? `${centerLabel}：${centerValue ?? ""}` : "占比图"}
    >
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--color-border)" strokeWidth={thickness} aria-hidden="true" />
      {total > 0
        ? visible.map((seg, i) => {
            const len = (seg.value / total) * circumference;
            const el = (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={thickness}
                strokeDasharray={`${len} ${circumference - len}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${cx} ${cy})`}
                aria-hidden="true"
              />
            );
            offset += len;
            return el;
          })
        : null}
      {centerLabel || centerValue ? (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-ink-primary"
          style={{ fontSize: size / 6, fontWeight: 600 }}
        >
          {centerValue ?? ""}
        </text>
      ) : null}
      {centerLabel ? (
        <text
          x={cx}
          y={cy + size / 5}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-ink-muted"
          style={{ fontSize: size / 11 }}
        >
          {centerLabel}
        </text>
      ) : null}
    </svg>
  );
}
