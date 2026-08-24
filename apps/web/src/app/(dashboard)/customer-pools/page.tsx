"use client";

/**
 * Phase 2C — Customer Pool Workspace：公海池列表（CTO 生产测试 MVP）
 */
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityListWorkspace } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS } from "@/lib/ui-classes";
import { useListQuery } from "@/lib/use-list-query";

interface PoolRow {
  id: string;
  code: string;
  name: string;
  scopeType: string;
  scopeValue: string | null;
  isActive: boolean;
  _count: { rules: number; entries: number };
}

const SCOPE_LABELS: Record<string, string> = { GLOBAL: "全局", REGION: "区域", DEPARTMENT: "部门" };

function CustomerPoolList() {
  const { items, total, page, pageSize, loading, error, setPage, refresh } = useListQuery<PoolRow>("/api/customer-pools", {});

  return (
    <AppPage>
      <EntityListWorkspace<PoolRow>
        title="客户公海"
        description="多公海池定义：GLOBAL / REGION（区域字符串）/ DEPARTMENT（部门）"
        emptyMessage="暂无公海池——点击「新建公海池」创建第一个池"
        headerActions={
          <PermissionGuard permission={actionPermission("customer-pool", "create")}>
            <Link href="/customer-pools/new" className={BUTTON_PRIMARY_CLASS}>
              + 新建公海池
            </Link>
          </PermissionGuard>
        }
        columns={[
          { key: "code", header: "编码" },
          { key: "name", header: "名称" },
          { key: "scopeType", header: "范围", render: (r) => SCOPE_LABELS[r.scopeType] ?? r.scopeType },
          { key: "scopeValue", header: "范围值", render: (r) => r.scopeValue ?? "—" },
          { key: "isActive", header: "状态", render: (r) => (r.isActive ? "启用" : "停用") },
          { key: "counts", header: "规则/条目", render: (r) => String(r._count?.rules ?? 0) + " / " + String(r._count?.entries ?? 0) },
        ]}
        rows={items}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        onRetry={refresh}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        rowActions={(r: PoolRow) => (
          <Link href={"/customer-pools/" + r.id} className="text-brand-600 hover:underline">
            查看
          </Link>
        )}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("customer-pool", "view")}>
      <CustomerPoolList />
    </PermissionGuard>
  );
}
