"use client";

/**
 * Phase 2C — Customer Pool Workspace：公海池列表（多公海：GLOBAL/REGION/DEPARTMENT）
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const { items, total, page, pageSize, loading, error, setPage } = useListQuery<PoolRow>("/api/customer-pools");

  return (
    <AppPage title="客户公海" description="多公海池定义：GLOBAL / REGION（区域字符串）/ DEPARTMENT（部门）">
      <div className="mb-4 flex justify-end">
        <PermissionGuard permission={actionPermission("customer-pool", "create")}>
          <Link href="/customer-pools/new" className={BUTTON_PRIMARY_CLASS}>
            新建公海池
          </Link>
        </PermissionGuard>
      </div>
      <EntityListWorkspace
        title="公海池列表"
        columns={[
          { key: "code", label: "编码" },
          { key: "name", label: "名称" },
          { key: "scopeType", label: "范围", render: (r: PoolRow) => SCOPE_LABELS[r.scopeType] ?? r.scopeType },
          { key: "scopeValue", label: "范围值", render: (r: PoolRow) => r.scopeValue ?? "—" },
          { key: "isActive", label: "状态", render: (r: PoolRow) => (r.isActive ? "启用" : "停用") },
          { key: "counts", label: "规则/条目", render: (r: PoolRow) => String(r._count?.rules ?? 0) + " / " + String(r._count?.entries ?? 0) },
        ]}
        items={items}
        total={total}
        page={page}
        pageSize={pageSize}
        loading={loading}
        error={error}
        onPageChange={setPage}
        onRowClick={(r: PoolRow) => router.push("/customer-pools/" + r.id)}
        emptyText="暂无公海池。点击右上角「新建公海池」创建。"
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
