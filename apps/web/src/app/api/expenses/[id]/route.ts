import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/expenses/:id —— 报销申请详情（只读，消费 ProjectExpense 事实）
 * 客户归属：ProjectExpense → Project → BusinessPartner（customerId）。
 * 申请人（createdBy）/ 审批人（approvedBy）/ 驳回人（rejectedBy）一并投影（报销详情显示要求，Migration 0051）。
 * 注：ProjectExpense 无 User 关系字段（仓库惯例为裸 *ById），故二次查询 User 组装，不做 schema 关系扩展。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-expense:view");
  if (denied) return denied;
  requestLog(request, user?.id, "expense.get");

  const { id } = await params;
  const item = await prisma.projectExpense.findFirst({
    where: { id, deletedAt: null },
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
  });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "报销申请不存在");

  // 申请人/审批人/驳回人（User 无关系字段，按 *ById 二次查询组装）
  const userIds = [item.createdById, item.approvedById, item.rejectedById].filter(
    (v): v is string => Boolean(v),
  );
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  return ok({
    ...item,
    createdBy: item.createdById ? (userMap.get(item.createdById) ?? null) : null,
    approvedBy: item.approvedById ? (userMap.get(item.approvedById) ?? null) : null,
    rejectedBy: item.rejectedById ? (userMap.get(item.rejectedById) ?? null) : null,
  });
}
