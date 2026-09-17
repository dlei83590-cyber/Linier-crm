"use client";

/**
 * CheckboxGroup — 枚举字段勾选组（FE 2.0 UI-01 家族：FormField / Select 同层）
 *
 * 用途：主数据枚举字段的「勾选」交互（企业资质多选 / 所有制性质单选 / 上市状态单选）。
 * - multi=true：多选（企业资质）；
 * - multi=false：单选，再次点击已选项即取消选择（保留「未设置」语义，避免 radio 无法反选）。
 * 值统一以 string[] 承载，调用方决定单选时取 [0] 或空数组。
 * 无障碍：字段标签非 label 包裹（避免嵌套 label），勾选项各自为原生 label + checkbox。
 */
export interface CheckboxOption {
  value: string;
  label: string;
}

export interface CheckboxGroupProps {
  /** 字段标签（渲染为 span，不做 label 包裹） */
  label: string;
  options: readonly CheckboxOption[];
  /** 已选值（单选时为 0/1 元素） */
  value: string[];
  onChange: (next: string[]) => void;
  /** 多选（默认 false = 单选，可反选取消） */
  multi?: boolean;
  /** 帮助文案 */
  hint?: string;
  className?: string;
}

export function CheckboxGroup({
  label,
  options,
  value,
  onChange,
  multi = false,
  hint,
  className = "",
}: CheckboxGroupProps) {
  const toggle = (code: string) => {
    if (multi) {
      onChange(value.includes(code) ? value.filter((v) => v !== code) : [...value, code]);
      return;
    }
    onChange(value.includes(code) ? [] : [code]);
  };

  return (
    <div className={"flex flex-col gap-1 " + className}>
      <span className="text-ink-secondary text-sm font-medium">{label}</span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="text-ink-secondary flex cursor-pointer items-center gap-1.5 text-sm"
          >
            <input
              type="checkbox"
              checked={value.includes(o.value)}
              onChange={() => toggle(o.value)}
              className="h-3.5 w-3.5"
            />
            {o.label}
          </label>
        ))}
      </div>
      {hint ? <span className="text-ink-muted text-xs">{hint}</span> : null}
    </div>
  );
}
