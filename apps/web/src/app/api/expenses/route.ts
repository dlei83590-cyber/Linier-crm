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
  // 报销流程补齐（Migration 0051）：按审批状态精确筛选（待审批列表等）
  const status = searchParams.get("status")?.trim();

  const where = {
    deletedAt: null,
    ...(projectId ? { projectId } : {}),
    ...(customerId ? { project: { customerId } } : {}),
    ...(category ? { category: { contains: category } } : {}),
    ...(status ? { approvalStatus: status } : {}),
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

  // 申请人/审批人投影（无 User 关系字段，按 *ById 一次查询组装）
  const userIds = Array.from(
    new Set(items.flatMap((i) => [i.createdById, i.approvedById, i.rejectedById]).filter((v): v is string => Boolean(v))),
  );
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));
  const rows = items.map((i) => ({
    ...i,
    createdBy: i.createdById ? (userMap.get(i.createdById) ?? null) : null,
    approvedBy: i.approvedById ? (userMap.get(i.approvedById) ?? null) : null,
    rejectedBy: i.rejectedById ? (userMap.get(i.rejectedById) ?? null) : null,
  }));

  return ok(rows, { page, pageSize, total });
}
