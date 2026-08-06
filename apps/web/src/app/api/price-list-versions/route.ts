import { NextRequest } from "next/server";
import type { PriceListStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const priceListVersionCreateSchema = z.object({
  priceListId: z.string().min(1),
  versionNo: z.number().int().positive(),
  revisionNo: z.number().int().positive().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  changeSummary: z.string().max(500).nullable().optional(),
  workflowInstanceId: z.string().min(1).nullable().optional(),
});

/** GET /api/price-list-versions（分页 + priceListId/status 过滤，Sprint 3C-4 Price Foundation） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-list-version:view");
  if (denied) return denied;
  requestLog(request, user?.id, "price-list-version.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const priceListId = searchParams.get("priceListId")?.trim();
  const status = searchParams.get("status")?.trim();

  const where = {
    deletedAt: null,
    ...(priceListId ? { priceListId } : {}),
    ...(status ? { status: status as PriceListStatus } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.priceListVersion.count({ where }),
    prisma.priceListVersion.findMany({
      where,
      orderBy: [{ versionNo: "desc" }, { createdAt: "desc" }],
      skip,
      take,
      include: {
        priceList: { select: { id: true, code: true, name: true, currency: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/price-list-versions（创建版本：priceListId+versionNo 复合唯一；发布需关联 Workflow） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-list-version:create");
  if (denied) return denied;
  requestLog(request, user?.id, "price-list-version.create");

  const meta = requestMeta(request);
  const parsed = priceListVersionCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const priceList = await prisma.priceList.findFirst({ where: { id: parsed.data.priceListId, deletedAt: null } });
  if (!priceList) return failConflict(ERROR_CODES.NOT_FOUND, "关联价目表不存在");

  const existing = await prisma.priceListVersion.findUnique({
    where: { priceListId_versionNo: { priceListId: parsed.data.priceListId, versionNo: parsed.data.versionNo } },
  });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "该价目表版本号已存在");
  }

  const created = await prisma.priceListVersion.create({
    data: {
      priceListId: parsed.data.priceListId,
      versionNo: parsed.data.versionNo,
      revisionNo: parsed.data.revisionNo ?? 1,
      status: (parsed.data.status as PriceListStatus) ?? "DRAFT",
      changeSummary: parsed.data.changeSummary ?? null,
      workflowInstanceId: parsed.data.workflowInstanceId ?? null,
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "price-list-version.create",
    entityType: "priceListVersion",
    entityId: created.id,
    afterData: { priceListId: created.priceListId, versionNo: created.versionNo, status: created.status },
    ...meta,
  });

  return ok(created, undefined, 201);
}
