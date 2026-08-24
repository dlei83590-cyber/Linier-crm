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
  return ok(item);
}
