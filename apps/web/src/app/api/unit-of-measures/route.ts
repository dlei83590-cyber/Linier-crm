import { NextRequest } from "next/server";
import type { ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { handleServerError } from "@/lib/api/server-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

const unitOfMeasureCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  symbol: z.string().max(20).nullable().optional(),
});

/** GET /api/unit-of-measures（分页 + code/name/isActive/approvalStatus 过滤，Master-Data Read API — UOM；SSOT = Prisma UnitOfMeasure；D3：默认 isActive=true，approvalStatus 仅显式 filter） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "unit-of-measure:view");
  if (denied) return denied;
  requestLog(request, user?.id, "unit-of-measure.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const isActive = searchParams.get("isActive")?.trim();
  const approvalStatus = searchParams.get("approvalStatus")?.trim();

  const where = {
    deletedAt: null,
    // D3：UOM 查询默认只给业务表单消费可用事实（isActive=true）；approvalStatus 仅显式 filter
    ...(isActive === "false" ? { isActive: false } : { isActive: true }),
    ...(code ? { code: { contains: code, mode: "insensitive" as const } } : {}),
    ...(name ? { name: { contains: name, mode: "insensitive" as const } } : {}),
    ...(approvalStatus ? { approvalStatus: approvalStatus as ApprovalStatus } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.unitOfMeasure.count({ where }),
    prisma.unitOfMeasure.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/unit-of-measures（创建计量单位：code 唯一） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "unit-of-measure:create");
  if (denied) return denied;
  requestLog(request, user?.id, "unit-of-measure.create");

  const meta = requestMeta(request);
  const parsed = unitOfMeasureCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    const existing = await prisma.unitOfMeasure.findUnique({ where: { code: parsed.data.code } });
    if (existing && !existing.deletedAt) {
      return failConflict(ERROR_CODES.CONFLICT, "计量单位编码已存在");
    }

    const created = await prisma.unitOfMeasure.create({
      data: {
        code: parsed.data.code,
        name: parsed.data.name,
        symbol: parsed.data.symbol ?? null,
        approvalStatus: "APPROVED",
        createdById: user?.id ?? null,
        updatedById: user?.id ?? null,
      },
    });

    await writeAuditLog({
      actorId: user?.id,
      action: "unit-of-measure.create",
      entityType: "unitOfMeasure",
      entityId: created.id,
      afterData: { code: created.code, name: created.name },
      ...meta,
    });

    return ok(created, undefined, 201);
  } catch (err) {
    // P2002：code @unique 冲突——软删记录仍占用编码（findUnique 放行 → create 撞唯一约束）→ 友好 409
    if (err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "P2002") {
      return failConflict(ERROR_CODES.CONFLICT, "计量单位编码已存在（历史删除记录仍占用该编码，请更换编码）");
    }
    // 其他运行时错误：结构化日志 + 500（不泄露 stack；P0 Incident R2 模式）
    return handleServerError(request, user?.id, "unit-of-measure.create", err);
  }
}
