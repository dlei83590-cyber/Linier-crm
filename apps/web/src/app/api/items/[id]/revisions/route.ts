import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const revisionCreateSchema = z.object({
  revision: z.string().min(1).max(50),
  changeSummary: z.string().min(1).max(500),
  status: z.enum(["DRAFT", "RELEASED", "SUPERSEDED"]).default("RELEASED"),
});

/** GET /api/items/:id/revisions（版本历史） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-revision:view");
  if (denied) return denied;
  requestLog(request, user?.id, "item-revision.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const item = await prisma.item.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");

  const [total, items] = await Promise.all([
    prisma.itemRevision.count({ where: { itemId: id, deletedAt: null } }),
    prisma.itemRevision.findMany({
      where: { itemId: id, deletedAt: null },
      orderBy: { revisionNo: "desc" },
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/items/:id/revisions（发布新版本，revisionNo 自动 +1；同步 Item.revision） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-revision:create");
  if (denied) return denied;
  requestLog(request, user?.id, "item-revision.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = revisionCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const item = await prisma.item.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");

  const last = await prisma.itemRevision.findFirst({
    where: { itemId: id, deletedAt: null },
    orderBy: { revisionNo: "desc" },
    select: { revisionNo: true },
  });
  const revisionNo = (last?.revisionNo ?? 0) + 1;

  const created = await prisma.$transaction(async (tx) => {
    if (parsed.data.status === "RELEASED") {
      await tx.itemRevision.updateMany({
        where: { itemId: id, deletedAt: null, status: "RELEASED" },
        data: { status: "SUPERSEDED", updatedById: user?.id ?? null },
      });
    }
    const rev = await tx.itemRevision.create({
      data: {
        itemId: id,
        revisionNo,
        revision: parsed.data.revision,
        changeSummary: parsed.data.changeSummary,
        status: parsed.data.status,
        releasedById: user?.id ?? null,
        createdById: user!.id,
        updatedById: user!.id,
      },
    });
    if (parsed.data.status === "RELEASED") {
      await tx.item.update({ where: { id }, data: { revision: parsed.data.revision, updatedById: user!.id } });
    }
    return rev;
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "item-revision.create",
    entityType: "item-revision",
    entityId: created.id,
    meta: { itemId: id, revisionNo: created.revisionNo, revision: created.revision, status: created.status },
    ...meta,
  });

  return ok(created, undefined, 201);
}
