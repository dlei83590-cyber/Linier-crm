import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const commercialTermCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
});

/** GET /api/commercial-terms（分页 + code/name/isActive 过滤） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "commercial-term:view");
  if (denied) return denied;
  requestLog(request, user?.id, "commercial-term.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const isActive = searchParams.get("isActive")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code, mode: "insensitive" as const } } : {}),
    ...(name ? { name: { contains: name, mode: "insensitive" as const } } : {}),
    ...(isActive === "true" ? { isActive: true } : isActive === "false" ? { isActive: false } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.commercialTerm.count({ where }),
    prisma.commercialTerm.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/commercial-terms（创建商业条款：code 唯一） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "commercial-term:create");
  if (denied) return denied;
  requestLog(request, user?.id, "commercial-term.create");

  const meta = requestMeta(request);
  const parsed = commercialTermCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.commercialTerm.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "商业条款编码已存在");
  }

  const created = await prisma.commercialTerm.create({
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
    action: "commercial-term.create",
    entityType: "commercialTerm",
    entityId: created.id,
    afterData: { code: created.code, name: created.name },
    ...meta,
  });

  return ok(created, undefined, 201);
}