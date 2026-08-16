import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const budgetCreateSchema = z.object({
  category: z.string().min(1).max(100),
  amount: z.coerce.number().nonnegative(),
  currency: z.string().max(10).optional(),
  note: z.string().max(500).nullable().optional(),
});

/** GET /api/projects/:id/budgets（项目预算，按科目，Sprint 3C-5） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-budget:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-budget.list");

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
    prisma.projectBudget.count({ where }),
    prisma.projectBudget.findMany({ where, orderBy: { createdAt: "asc" }, skip, take }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/projects/:id/budgets（新增预算） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-budget:create");
  if (denied) return denied;
  requestLog(request, user?.id, "project-budget.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = budgetCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };

    const created = await tx.projectBudget.create({
      data: {
        projectId: id,
        category: parsed.data.category,
        amount: parsed.data.amount,
        currency: parsed.data.currency ?? "CNY",
        note: parsed.data.note ?? null,
        approvalStatus: "APPROVED",
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
    action: "project-budget.create",
    entityType: "projectBudget",
    entityId: created.id,
    afterData: { projectId: id, category: created.category, amount: created.amount },
    ...meta,
  });

  return ok(created, undefined, 201);
}
