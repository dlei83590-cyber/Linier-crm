import { NextRequest } from "next/server";
import type { ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { requestLog } from "@/lib/api/logger";
import { ok, parsePagination } from "@/lib/api/response";

export const dynamic = "force-dynamic";

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
