import { NextRequest } from "next/server";
import type { CustomerPoolScopeType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { handleServerError } from "@/lib/api/server-error";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";
import { validatePoolScope } from "@/lib/customer-pool/validators";

export const dynamic = "force-dynamic";

/** Phase 2C 客户公海池定义（ADR-0053 APPROVED；OQ-5：v1 无 approvalStatus，仅 RBAC + version + Audit） */
const poolCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(500).nullable().optional(),
  scopeType: z.enum(["GLOBAL", "REGION", "DEPARTMENT"]),
  scopeValue: z.string().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
});

/** GET /api/customer-pools（分页 + code/name/scopeType/isActive 过滤） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-pool:view");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-pool.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const scopeType = searchParams.get("scopeType")?.trim();
  const isActive = searchParams.get("isActive")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code, mode: "insensitive" as const } } : {}),
    ...(name ? { name: { contains: name, mode: "insensitive" as const } } : {}),
    ...(scopeType ? { scopeType: scopeType as CustomerPoolScopeType } : {}),
    ...(isActive === "true" ? { isActive: true } : isActive === "false" ? { isActive: false } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.customerPool.count({ where }),
    prisma.customerPool.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { _count: { select: { rules: true, entries: true } } },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/customer-pools（创建公海池：code unique；scopeType/value 服务端组合校验） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-pool:create");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-pool.create");

  const meta = requestMeta(request);
  const parsed = poolCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const scopeCheck = validatePoolScope(parsed.data.scopeType, parsed.data.scopeValue);
  if (!scopeCheck.ok) {
    return fail(scopeCheck.errorCode ?? ERROR_CODES.POOL_SCOPE_INVALID, scopeCheck.message ?? "scope 非法", 400);
  }

  const codeExisting = await prisma.customerPool.findUnique({ where: { code: parsed.data.code } });
  if (codeExisting && !codeExisting.deletedAt) {
    return failConflict(ERROR_CODES.POOL_CODE_EXISTS, "公海池编码已存在");
  }

  let created;
  try {
    created = await prisma.customerPool.create({
      data: {
        code: parsed.data.code,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        scopeType: parsed.data.scopeType,
        scopeValue: parsed.data.scopeValue?.trim() || null,
        isActive: parsed.data.isActive ?? true,
        createdById: user?.id ?? null,
        updatedById: user?.id ?? null,
      },
    });
  } catch (err) {
    if (err !== null && typeof err === "object" && (err as { code?: unknown }).code === "P2002") {
      return failConflict(ERROR_CODES.POOL_CODE_EXISTS, "公海池编码已存在");
    }
    return handleServerError(request, user?.id, "customer-pool.create", err);
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-pool.create",
    entityType: "customerPool",
    entityId: created.id,
    afterData: { code: created.code, name: created.name, scopeType: created.scopeType },
    ...meta,
  });

  return ok(created, undefined, 201);
}
