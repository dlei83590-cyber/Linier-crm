import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, parsePagination } from "@/lib/api/response";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/expenses —— 报销申请列表（跨项目只读 Query，消费 ProjectExpense 事实）
 *
 * 报销申请复用现有 ProjectExpense 模型（禁止平行新模型）：客户归属直接走
 * Project → BusinessPartner（customerId），不新造归属字段。
 * 创建/编辑/删除仍走既有 /api/projects/:id/expenses（B2-1B 已交付 CRUD）；
 * 本端点只做跨项目只读聚合（按客户/项目/科目筛选），保持单一写入源。
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-expense:view");
  if (denied) return denied;
  requestLog(request, user?.id, "expense.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const customerId = searchParams.get("customerId")?.trim();
  const projectId = searchParams.get("projectId")?.trim();
  const category = searchParams.get("category")?.trim();

  const where = {
    deletedAt: null,
    ...(projectId ? { projectId } : {}),
    ...(customerId ? { project: { customerId } } : {}),
    ...(category ? { category: { contains: category } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.projectExpense.count({ where }),
    prisma.projectExpense.findMany({
      where,
      orderBy: [{ incurredAt: "desc" }, { createdAt: "desc" }],
      skip,
      take,
      include: {
        project: {
          select: {
            id: true,
            code: true,
            name: true,
            stage: true,
            customer: { select: { id: true, code: true, name: true, type: true } },
          },
        },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}
