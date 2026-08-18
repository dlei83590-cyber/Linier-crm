import { NextRequest } from "next/server";
import type { ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const technicalStandardCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
});

/** GET /api/technical-standards（分页 + code/name/isActive/approvalStatus 过滤） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "technical-standard:view");
  if (denied) return denied;
  requestLog(request, user?.id, "technical-standard.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const isActive = searchParams.get("isActive")?.trim();
  const approvalStatus = searchParams.get("approvalStatus")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code, mode: "insensitive" as const } } : {}),
    ...(name ? { name: { contains: name, mode: "insensitive" as const } } : {}),
    ...(isActive === "true" ? { isActive: true } : isActive === "false" ? { isActive: false } : {}),
    ...(approvalStatus ? { approvalStatus: approvalStatus as ApprovalStatus } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.technicalStandard.count({ where }),
    prisma.technicalStandard.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/technical-standards（创建技术标准：code 唯一） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "technical-standard:create");
  if (denied) return denied;
  requestLog(request, user?.id, "technical-standard.create");

  const meta = requestMeta(request);
  const parsed = technicalStandardCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.technicalStandard.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "技术标准编码已存在");
  }

  const created = await prisma.technicalStandard.create({
    data: {
      code: parsed.data.code,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      approvalStatus: "APPROVED",
      createdById: user?.id ?? null,
      updatedById: user?.id ?? null,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "technical-standard.create",
    entityType: "technicalStandard",
    entityId: created.id,
    afterData: { code: created.code, name: created.name },
    ...meta,
  });

  return ok(created, undefined, 201);
}