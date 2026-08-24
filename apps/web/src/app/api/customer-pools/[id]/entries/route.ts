import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failNotFound, failConflict } from "@/lib/api/response";
import { handleServerError } from "@/lib/api/server-error";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { writeDomainEvent } from "@/lib/domain-events/writer";
import { isPartnerPoolEligible } from "@/lib/customer-pool/validators";
import { z } from "zod";

export const dynamic = "force-dynamic";

const entryCreateSchema = z.object({
  businessPartnerId: z.string().min(1),
  enterReason: z.enum(["MANUAL", "FIELD_RULE", "RE_ENTER"]).optional(),
});

/** GET /api/customer-pools/:id/entries（池条目列表：BP 最小投影 + 当前 owner；分页 + status 过滤） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-pool:view");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-pool-entry.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "20") || 20));
  const status = searchParams.get("status")?.trim();

  const pool = await prisma.customerPool.findFirst({ where: { id, deletedAt: null } });
  if (!pool) return failNotFound(ERROR_CODES.POOL_NOT_FOUND, "公海池不存在");

  const where = {
    poolId: id,
    deletedAt: null,
    ...(status ? { status: status as "IN_POOL" | "CLAIMED" | "RELEASED" } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.customerPoolEntry.count({ where }),
    prisma.customerPoolEntry.findMany({
      where,
      orderBy: { enteredAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        businessPartner: { select: { id: true, code: true, name: true, type: true, isActive: true } },
        ownerships: {
          where: { releasedAt: null, deletedAt: null },
          select: { ownerId: true, claimedAt: true, owner: { select: { id: true, name: true, email: true } } },
          take: 1,
        },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/**
 * POST /api/customer-pools/:id/entries — 手工入池（CTO 全校验 + 事务 + Outbox 事件）
 *
 * 校验：pool active → BP 存在/未删/CUSTOMER|BOTH → 无 active ownership → 无 active entry → scope compatible
 * 事务：create entry + Outbox CustomerPoolEntryEntered 同事务；partial unique P2002 → 409 CUSTOMER_ALREADY_IN_POOL
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-pool:assign");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-pool-entry.enter");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = entryCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const pool = await prisma.customerPool.findFirst({ where: { id, deletedAt: null } });
  if (!pool) return failNotFound(ERROR_CODES.POOL_NOT_FOUND, "公海池不存在");
  if (!pool.isActive) {
    return fail(ERROR_CODES.POOL_ENTRY_NOT_ALLOWED, "公海池已停用，不能入池", 400);
  }

  const partner = await prisma.businessPartner.findFirst({
    where: { id: parsed.data.businessPartnerId, deletedAt: null },
    select: { id: true, type: true, region: true },
  });
  if (!partner) return failNotFound(ERROR_CODES.NOT_FOUND, "往来单位不存在");
  if (!isPartnerPoolEligible(partner.type)) {
    return fail(ERROR_CODES.POOL_ENTRY_NOT_ALLOWED, "仅 CUSTOMER / BOTH 类型的客户允许进入客户公海", 400);
  }

  // scope compatible：GLOBAL 任意；REGION → BP.region === scopeValue；DEPARTMENT → 操作者部门 === scopeValue
  if (pool.scopeType === "REGION" && partner.region !== pool.scopeValue) {
    return fail(ERROR_CODES.POOL_ENTRY_NOT_ALLOWED, "客户区域与公海 scope（REGION）不匹配", 400);
  }
  if (pool.scopeType === "DEPARTMENT") {
    const operator = user
      ? await prisma.user.findUnique({ where: { id: user.id }, select: { departmentId: true } })
      : null;
    if ((operator?.departmentId ?? null) !== pool.scopeValue) {
      return fail(ERROR_CODES.POOL_ENTRY_NOT_ALLOWED, "操作者部门与公海 scope（DEPARTMENT）不匹配", 400);
    }
  }

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      // 无 active ownership（核心不变量 I1 前置检查；DB partial unique 兜底）
      const activeOwnership = await tx.customerOwnership.findFirst({
        where: { businessPartnerId: partner.id, releasedAt: null, deletedAt: null },
        select: { id: true },
      });
      if (activeOwnership) throw new Error("ALREADY_OWNED");
      // 无 active entry（核心不变量 I2 前置检查）
      const activeEntry = await tx.customerPoolEntry.findFirst({
        where: { businessPartnerId: partner.id, status: { not: "RELEASED" }, deletedAt: null },
        select: { id: true },
      });
      if (activeEntry) throw new Error("ALREADY_IN_POOL");

      const entry = await tx.customerPoolEntry.create({
        data: {
          poolId: id,
          businessPartnerId: partner.id,
          status: "IN_POOL",
          enterReason: parsed.data.enterReason ?? "MANUAL",
          enteredById: user?.id ?? null,
          createdById: user?.id ?? null,
          updatedById: user?.id ?? null,
        },
      });

      await writeDomainEvent(tx, {
        eventType: "CustomerPoolEntryEntered",
        aggregateType: "CustomerPoolEntry",
        aggregateId: entry.id,
        payload: {
          entryId: entry.id,
          poolId: id,
          businessPartnerId: partner.id,
          enterReason: entry.enterReason,
          enteredBy: user?.id ?? null,
        },
        idempotencyKey: "CustomerPoolEntryEntered|" + entry.id,
      });

      return entry;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "ALREADY_OWNED") {
      return failConflict(ERROR_CODES.CUSTOMER_ALREADY_OWNED, "该客户已有有效归属，不能入池");
    }
    if (msg === "ALREADY_IN_POOL") {
      return failConflict(ERROR_CODES.CUSTOMER_ALREADY_IN_POOL, "该客户已在公海中（存在有效条目）");
    }
    if (e !== null && typeof e === "object" && (e as { code?: unknown }).code === "P2002") {
      // 并发双入池撞 CustomerPoolEntry_one_active_per_partner
      return failConflict(ERROR_CODES.CUSTOMER_ALREADY_IN_POOL, "该客户已在公海中（并发冲突）");
    }
    return handleServerError(request, user?.id, "customer-pool-entry.enter", e);
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-pool-entry.enter",
    entityType: "customerPoolEntry",
    entityId: created.id,
    afterData: { poolId: id, businessPartnerId: partner.id, enterReason: created.enterReason },
    ...meta,
  });

  return ok(created, undefined, 201);
}
