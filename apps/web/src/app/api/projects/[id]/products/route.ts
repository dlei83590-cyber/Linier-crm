import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const productCreateSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.coerce.number().nonnegative().nullable().optional(),
  priceSnapshotId: z.string().min(1).nullable().optional(), // CTO #3C5：价格快照引用（resolvePrice 生成，可空）
  note: z.string().max(500).nullable().optional(),
});

/** GET /api/projects/:id/products（项目产品，引用 Item 主数据；价格走 Price 快照，Sprint 3C-5） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-product:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-product.list");

  const { id } = await params;
  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, "项目不存在");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const itemId = searchParams.get("itemId")?.trim();

  const where = {
    projectId: id,
    deletedAt: null,
    ...(itemId ? { itemId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.projectProduct.count({ where }),
    prisma.projectProduct.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip,
      take,
      include: {
        item: { select: { id: true, code: true, name: true, model: true, unitId: true } },
        priceSnapshot: { select: { id: true, finalUnitPrice: true, finalAmount: true, currency: true, pricingTime: true, pricingEngineVersion: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/projects/:id/products（新增项目产品；价格必须通过 resolvePrice() 生成快照后引用，禁止手工填价） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-product:create");
  if (denied) return denied;
  requestLog(request, user?.id, "project-product.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = productCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, "项目不存在");

  const item = await prisma.item.findFirst({ where: { id: parsed.data.itemId, deletedAt: null } });
  if (!item) return failConflict(ERROR_CODES.NOT_FOUND, "关联物料不存在");

  if (parsed.data.priceSnapshotId) {
    const snapshot = await prisma.quotationPriceSnapshot.findFirst({ where: { id: parsed.data.priceSnapshotId } });
    if (!snapshot) return failConflict(ERROR_CODES.NOT_FOUND, "价格快照不存在");
  }

  const created = await prisma.projectProduct.create({
    data: {
      projectId: id,
      itemId: parsed.data.itemId,
      quantity: parsed.data.quantity ?? null,
      priceSnapshotId: parsed.data.priceSnapshotId ?? null,
      note: parsed.data.note ?? null,
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-product.create",
    entityType: "projectProduct",
    entityId: created.id,
    afterData: { projectId: id, itemId: created.itemId, priceSnapshotId: created.priceSnapshotId },
    ...meta,
  });

  return ok(created, undefined, 201);
}
