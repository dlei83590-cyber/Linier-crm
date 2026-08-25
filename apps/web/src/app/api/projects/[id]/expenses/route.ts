import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const expenseCreateSchema = z.object({
  category: z.string().min(1).max(100),
  expenseType: z.string().max(50).nullable().optional(), // 费用类型（差旅/业务招待/办公/通讯/交通/培训/其他）
  expenseAttribution: z.string().max(50).nullable().optional(), // 费用归属（公司承担/客户承担/项目承担/其他）
  amount: z.coerce.number().nonnegative(),
  currency: z.string().max(10).optional(),
  incurredAt: z.string().datetime().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

/** GET /api/projects/:id/expenses（项目费用，实际支出，Sprint 3C-5） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-expense:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-expense.list");

  const { id } = await params;
  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, "项目不存在");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const category = searchParams.get("category")?.trim();

  const where = {
    projectId: id,
    deletedAt: null,
    ...(category ? { category: { contains: category } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.projectExpense.count({ where }),
    prisma.projectExpense.findMany({ where, orderBy: { incurredAt: "desc" }, skip, take }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/projects/:id/expenses（新增费用） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-expense:create");
  if (denied) return denied;
  requestLog(request, user?.id, "project-expense.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = expenseCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };

    const created = await tx.projectExpense.create({
      data: {
        projectId: id,
        category: parsed.data.category,
        expenseType: parsed.data.expenseType ?? null,
        expenseAttribution: parsed.data.expenseAttribution ?? null,
        amount: parsed.data.amount,
        currency: parsed.data.currency ?? "CNY",
        incurredAt: parsed.data.incurredAt ? new Date(parsed.data.incurredAt) : null,
        note: parsed.data.note ?? null,
        // 报销流程补齐（Migration 0051）：新建默认 DRAFT，走 提交(PENDING)→批准/驳回（不再创建即 APPROVED）
        approvalStatus: "DRAFT",
        createdById: user!.id,
        updatedById: user!.id,
      },
    });
    return { created };
  });
  if ("error" in txResult) return txResult.error;
  const created = txResult.created;

  await writeAuditLog({
    actorId: user?.id,
    action: "project-expense.create",
    entityType: "projectExpense",
    entityId: created.id,
    afterData: { projectId: id, category: created.category, amount: created.amount },
    ...meta,
  });

  return ok(created, undefined, 201);
}
