"use client";

/**
 * PermissionTree — 系统权限树（域 → 模块 → 动作）三级勾选组件
 *
 * 用于角色权限分配（/roles/new、/roles/[id]/edit）。
 * - 三态勾选：域/模块节点支持全选 / 半选 / 未选；
 * - 搜索：按模块（slug/中文名）与权限码（code/中文标签）过滤，命中即展开；
 * - 只读模式：readOnly=true 时仅展示勾选状态（无交互，供无 role:edit 权限者查看）；
 * - 分组与选择集运算全部来自 lib/frontend/permission-tree（纯函数），本组件不产生权限事实。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ACTION_LABELS } from "@/lib/frontend/labels";
import {
  buildPermissionTree,
  domainCodes,
  filterPermissionTree,
  moduleCodes,
  selectionState,
  treeStats,
  withCodes,
  type PermissionCatalogItem,
  type PermissionDomainNode,
  type PermissionModuleNode,
  type SelectionState,
} from "@/lib/frontend/permission-tree";
import { BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";

export interface PermissionTreeProps {
  /** 权限目录（GET /api/permissions data.items） */
  items: readonly PermissionCatalogItem[];
  /** 已选权限码 */
  selected: ReadonlySet<string>;
  /** 选择集变更（父组件负责 dirty 标记与提交） */
  onChange: (next: Set<string>) => void;
  /** 只读模式（无 role:edit 权限时仅查看） */
  readOnly?: boolean;
  className?: string;
}

function TriCheckbox({
  state,
  disabled,
  label,
  onChange,
}: {
  state: SelectionState;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "partial";
  }, [state]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === "all"}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(e.target.checked)}
      className="h-3.5 w-3.5 shrink-0 cursor-pointer disabled:cursor-not-allowed"
    />
  );
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function PermissionTree({
  items,
  selected,
  onChange,
  readOnly = false,
  className = "",
}: PermissionTreeProps) {
  const [query, setQuery] = useState("");
  const [expandedDomains, setExpandedDomains] = useState<ReadonlySet<string>>(new Set());
  const [expandedModules, setExpandedModules] = useState<ReadonlySet<string>>(new Set());

  const tree = useMemo(() => buildPermissionTree(items), [items]);
  const visibleTree = useMemo(() => filterPermissionTree(tree, query), [tree, query]);
  const stats = useMemo(() => treeStats(tree, selected), [tree, selected]);
  const searching = query.trim().length > 0;

  const toggleDomainExpand = (domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  const toggleModuleExpand = (module: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(module)) next.delete(module);
      else next.add(module);
      return next;
    });
  };

  const isDomainExpanded = (domain: PermissionDomainNode) =>
    searching || expandedDomains.has(domain.domain);

  const applyDomain = (domain: PermissionDomainNode, checked: boolean) => {
    onChange(withCodes(selected, domainCodes(domain), checked));
  };

  const applyModule = (node: PermissionModuleNode, checked: boolean) => {
    onChange(withCodes(selected, moduleCodes(node), checked));
    setExpandedModules((prev) => {
      if (prev.has(node.module)) return prev;
      const next = new Set(prev);
      next.add(node.module);
      return next;
    });
  };

  const applyCode = (code: string, checked: boolean) => {
    onChange(withCodes(selected, [code], checked));
  };

  const selectAll = () => onChange(withCodes(selected, items.map((i) => i.code), true));
  const clearAll = () => onChange(new Set<string>());

  return (
    <div className={"flex flex-col gap-3 " + className}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索模块或权限（如 采购 / purchase-order:create）"
          className={"w-72 " + SELECT_CLASS}
          aria-label="搜索权限"
        />
        {!readOnly ? (
          <>
            <button type="button" onClick={selectAll} className={BUTTON_SECONDARY_CLASS}>
              全选
            </button>
            <button type="button" onClick={clearAll} className={BUTTON_SECONDARY_CLASS}>
              清空
            </button>
          </>
        ) : null}
        <span className="text-xs text-ink-secondary">
          已选 <span className="font-medium text-ink-primary">{stats.selected}</span> / {stats.total} 项
          ｜模块 {stats.selectedModules} / {stats.modules}
        </span>
      </div>

      {readOnly ? (
        <p className="text-xs text-ink-muted">只读模式：当前账号无 role:edit 权限，仅展示已分配权限。</p>
      ) : null}

      {visibleTree.length === 0 ? (
        <p className="text-sm text-ink-secondary">无匹配权限。</p>
      ) : (
        <div className="space-y-2">
          {visibleTree.map((domain) => {
            const codes = domainCodes(domain);
            const state = selectionState(selected, codes);
            const expanded = isDomainExpanded(domain);
            const selectedInDomain = codes.filter((c) => selected.has(c)).length;

            return (
              <div key={domain.domain} className="rounded-md border border-border">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <TriCheckbox
                    state={state}
                    disabled={readOnly}
                    label={`${domain.label} 全选`}
                    onChange={(checked) => applyDomain(domain, checked)}
                  />
                  <button
                    type="button"
                    onClick={() => toggleDomainExpand(domain.domain)}
                    className="flex flex-1 items-center gap-2 text-left text-sm font-medium text-ink-primary"
                    aria-expanded={expanded}
                  >
                    <span className="text-ink-muted">{expanded ? "▾" : "▸"}</span>
                    {domain.label}
                    <span className="text-xs font-normal text-ink-secondary">
                      {domain.modules.length} 模块 ｜ 已选 {selectedInDomain}/{codes.length}
                    </span>
                  </button>
                </div>

                {expanded ? (
                  <div className="space-y-1 border-t border-border px-2 py-2">
                    {domain.modules.map((node) => {
                      const nodeCodes = moduleCodes(node);
                      const nodeState = selectionState(selected, nodeCodes);
                      const nodeExpanded = searching || expandedModules.has(node.module);
                      const selectedInModule = nodeCodes.filter((c) => selected.has(c)).length;

                      return (
                        <div key={node.module} className="rounded border border-border/60 px-2 py-1">
                          <div className="flex items-center gap-2">
                            <TriCheckbox
                              state={nodeState}
                              disabled={readOnly}
                              label={`${node.label} 全选`}
                              onChange={(checked) => applyModule(node, checked)}
                            />
                            <button
                              type="button"
                              onClick={() => toggleModuleExpand(node.module)}
                              className="flex flex-1 items-center gap-2 text-left text-xs text-ink-secondary"
                              aria-expanded={nodeExpanded}
                            >
                              <span className="text-ink-muted">{nodeExpanded ? "▾" : "▸"}</span>
                              <span className="font-medium text-ink-primary">{node.label}</span>
                              <span className="font-mono text-[11px] text-ink-muted">{node.module}</span>
                              <span>
                                已选 {selectedInModule}/{nodeCodes.length}
                              </span>
                            </button>
                          </div>

                          {nodeExpanded ? (
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 pl-5">
                              {node.permissions.map((p) => (
                                <label
                                  key={p.code}
                                  className="flex cursor-pointer items-center gap-1 text-xs text-ink-secondary"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selected.has(p.code)}
                                    disabled={readOnly}
                                    onChange={(e) => applyCode(p.code, e.target.checked)}
                                    className="h-3 w-3 cursor-pointer disabled:cursor-not-allowed"
                                  />
                                  <span title={p.code}>{actionLabel(p.action)}</span>
                                </label>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
