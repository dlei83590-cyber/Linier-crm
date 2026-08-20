'use client';

/**
 * AppPage — 标准业务页面外壳（F2-1 UI System Foundation）
 *
 * 统一页面级：背景 / 内容宽度 / 内边距 / 密度。
 * 业务页面一律以 <AppPage> 作为最外层容器，禁止自造页面级容器。
 */
import { FORM_DENSITY, type Density } from '@/components/design-system';
import { useTableDensity } from "@/lib/table-density-context";

export type AppPageMaxWidth = '4xl' | '6xl' | '7xl' | 'full';

const MAX_WIDTH_CLASS: Record<AppPageMaxWidth, string> = {
  '4xl': 'max-w-4xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
  full: 'max-w-full',
};

interface AppPageProps {
  children: React.ReactNode;
  /** 内容最大宽度，默认 7xl（1280px） */
  maxWidth?: AppPageMaxWidth;
  /** 表单/表格密度（影响页内垂直节奏），默认 default */
  density?: Density;
  className?: string;
}

export function AppPage({
  children,
  maxWidth = '7xl',
  density = 'default',
  className = '',
}: AppPageProps) {
  // U5：全局密度（组件自身 density prop 优先于 DensityContext）
  const { density: ctxDensity } = useTableDensity();
  const effectiveDensity = density ?? ctxDensity;
  const form = FORM_DENSITY[effectiveDensity];
  return (
    <div className={`bg-canvas min-h-full ${className}`}>
      <div
        className={`mx-auto w-full ${MAX_WIDTH_CLASS[maxWidth]} px-4 py-6 md:px-6`}
        style={{ paddingTop: form.height }}
      >
        {children}
      </div>
    </div>
  );
}
