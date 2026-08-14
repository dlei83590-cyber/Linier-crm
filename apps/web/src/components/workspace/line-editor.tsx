'use client';

/**
 * LineEditor — 单据行编辑表（F2-1 UI System Foundation）
 *
 * 统一 Create/Edit 表单中的行编辑区（PO/Receipt/Invoice 行等）。
 * - 受控组件：lines / onChange 由业务层持有
 * - 列类型：text / number / select / readonly（render 自定义）
 * - 行内编辑即时回调 onChange；新增/删除由业务层通过 newRow / onRemove 控制
 */
import { CONTROL_CLASS, TABLE_DENSITY, type Density } from '@/components/design-system';
import type { ReferenceOption } from './reference-selector';

/** 行数据基类：id 必须稳定（用于 key 与删除） */
export interface LineRow {
  id: string;
  [key: string]: unknown;
}

export interface LineColumn<T extends LineRow> {
  key: string;
  header: string;
  width?: string;
  type?: 'text' | 'number' | 'select' | 'readonly';
  /** select 类型选项 */
  options?: ReferenceOption[];
  placeholder?: string;
  align?: 'left' | 'right';
  /** readonly / 自定义渲染（优先于 type） */
  render?: (row: T) => React.ReactNode;
}

interface LineEditorProps<T extends LineRow> {
  columns: LineColumn<T>[];
  lines: T[];
  onChange: (lines: T[]) => void;
  /** 新增一行（返回新行对象；业务层负责生成稳定 id 与默认值） */
  onAdd: () => T;
  /** 删除一行（缺省直接按 id 删除） */
  onRemove?: (row: T) => void;
  addLabel?: string;
  disabled?: boolean;
  density?: Density;
  emptyMessage?: string;
}

function cellValue<T extends LineRow>(row: T, key: string): string {
  const v = row[key];
  if (v === null || v === undefined) return '';
  return String(v);
}

export function LineEditor<T extends LineRow>({
  columns,
  lines,
  onChange,
  onAdd,
  onRemove,
  addLabel = '新增行',
  disabled = false,
  density = 'default',
  emptyMessage = '暂无行数据',
}: LineEditorProps<T>) {
  const table = TABLE_DENSITY[density];

  const updateCell = (row: T, key: string, value: string) => {
    onChange(lines.map((r) => (r.id === row.id ? { ...r, [key]: value } : r)));
  };

  const removeRow = (row: T) => {
    if (onRemove) {
      onRemove(row);
      return;
    }
    onChange(lines.filter((r) => r.id !== row.id));
  };

  return (
    <div className="border-border overflow-hidden rounded-md border">
      <div className="border-border flex items-center justify-between border-b bg-slate-50 px-3 py-2">
        <span className="text-ink-secondary text-sm font-medium">行明细</span>
        <button
          type="button"
          onClick={() => onChange([...lines, onAdd()])}
          disabled={disabled}
          className="border-border bg-surface text-ink-primary rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          + {addLabel}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="divide-border min-w-full divide-y">
          <thead className="text-ink-secondary bg-slate-50 text-left text-xs font-medium">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className="px-3 py-2 font-medium"
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.header}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {lines.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="text-ink-muted px-3 py-6 text-center text-sm"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              lines.map((row) => (
                <tr key={row.id}>
                  {columns.map((col) => {
                    const value = cellValue(row, col.key);
                    const align = col.align === 'right' ? 'text-right' : 'text-left';
                    if (col.render) {
                      return (
                        <td
                          key={col.key}
                          className={`text-ink-primary whitespace-nowrap px-3 py-2 text-sm ${align}`}
                          style={{ fontSize: table.fontSize }}
                        >
                          {col.render(row)}
                        </td>
                      );
                    }
                    if (col.type === 'readonly') {
                      return (
                        <td
                          key={col.key}
                          className={`text-ink-primary whitespace-nowrap px-3 py-2 text-sm ${align}`}
                          style={{ fontSize: table.fontSize }}
                        >
                          {value || '—'}
                        </td>
                      );
                    }
                    if (col.type === 'select') {
                      return (
                        <td key={col.key} className="px-3 py-1">
                          <select
                            value={value}
                            disabled={disabled}
                            onChange={(e) => updateCell(row, col.key, e.target.value)}
                            className={`${CONTROL_CLASS} py-1`}
                          >
                            <option value="">请选择</option>
                            {(col.options ?? []).map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    }
                    return (
                      <td key={col.key} className="px-3 py-1">
                        <input
                          type={col.type === 'number' ? 'number' : 'text'}
                          value={value}
                          placeholder={col.placeholder}
                          disabled={disabled}
                          onChange={(e) => updateCell(row, col.key, e.target.value)}
                          className={`${CONTROL_CLASS} py-1 ${align}`}
                        />
                      </td>
                    );
                  })}
                  <td className="px-3 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(row)}
                      disabled={disabled}
                      className="border-border text-status-danger-text rounded-md border px-2 py-1 text-xs hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
