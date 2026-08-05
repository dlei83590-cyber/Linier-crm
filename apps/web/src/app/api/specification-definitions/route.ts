import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const defCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  unit: z.string().max(50).optional(),
  dataType: z.enum(["STRING", "DECIMAL", "INTEGER", "BOOLEAN", "DATE"]).default("STRING"),
  isRequired: z.boolean().default(false),
  sort: z.number().int().default(0),
});

/** GET /api/specification-definitions（规格定义列表，CTO #2138） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-specification:view");
  if (denied) return denied;
  requestLog(request, user?.id, "specification-definition.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const [total, items] = await Promise.all([
    prisma.specificationDefinition.count({ where: { deletedAt: null } }),
    prisma.specificationDefinition.findMany({
      where: { deletedAt: null },
      orderBy: [{ sort: "asc" }, { code: "asc" }],
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/specification-definitions（新增规格定义） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-specification:create");
  if (denied) return denied;
  requestLog(request, user?.id, "specification-definition.create");

  const meta = requestMeta(request);
  const parsed = defCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.specificationDefinition.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "规格定义编码已存在");
  }

  const created = await prisma.specificationDefinition.create({
    data: { ...parsed.data, createdById: user!.id, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "specification-definition.create",
    entityType: "specification-definition",
    entityId: created.id,
    afterData: { code: created.code, name: created.name, dataType: created.dataType },
    ...meta,
  });

  return ok(created, undefined, 201);
}
