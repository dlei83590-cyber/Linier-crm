import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, fail, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { writeOffCreateSchema } from "@/lib/api/schemas";
import { nextWriteOffCode, computeWriteOffTotal, validateWriteOffAmount } from "@/lib/write-off/helpers";
import { publishWriteOffEvent } from "@/lib/write-off/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/write-offs —— 创建 WriteOff（DRAFT + WriteOffAllocation 明细；拍板④：DocumentSequence 创建即取号 WO-2026-xxxx）
 * 校验（CTO 指令）：① 全部目标 AR 存在；② **同 Customer / 同 Currency**（否则 409 WRITE_OFF_SOURCE_NOT_COMPATIBLE）；
 * ③ 每笔 amount > 0（validateWriteOffAmount）；④ amount = Σ allocations（服务端计算，禁止直传头金额）
 * **暂不修改 AR**（审批通过 ≠ 自动修改余额；只有显式 Apply 才回写——CTO 锁死）
 * 事件：WriteOffCreated（AuditLog 留痕，失败降级不阻断主流程）
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "write-off:create");
  if (denied) return denied;
  requestLog(request, user?.id, "write-off.create");

  const parsed = writeOffCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { allocations, reason, writeOffDate, approvalPolicyId, changeReason } = parsed.data;
  const meta = requestMeta(request);

  // 目标 AR 去重聚合（同一 WriteOff 对同一 AR 一行；unique [writeOffId, accountsReceivableId]）
  const arAmount = new Map<string, Prisma.Decimal>();
  for (const a of allocations) {
    const prev = arAmount.get(a.accountsReceivableId) ?? new Prisma.Decimal(0);
    arAmount.set(a.accountsReceivableId, prev.plus(new Prisma.Decimal(a.amount)));
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. 校验目标 AR 存在 + 同 Customer / 同 Currency（硬规则，CTO 指令）
    const arIds = [...arAmount.keys()].sort();
    const ars = await tx.accountsReceivable.findMany({
      where: { id: { in: arIds }, deletedAt: null },
      select: { id: true, customerId: true, currency: true },
    });
    if (ars.length !== arIds.length) {
      const missing = arIds.filter((id) => !ars.some((a) => a.id === id));
      return { error: "AR_NOT_FOUND" as const, missingIds: missing };
    }
    const customerIds = new Set(ars.map((a) => a.customerId));
    const currencies = new Set(ars.map((a) => a.currency));
    if (customerIds.size !== 1 || currencies.size !== 1) {
      return {
        error: "SOURCE_NOT_COMPATIBLE" as const,
        customerCount: customerIds.size,
        currencyCount: currencies.size,
      };
    }

    // 2. 校验每笔 amount > 0（Decimal 精确比较）
    for (const [arId, amt] of arAmount.entries()) {
      const v = validateWriteOffAmount(amt);
      if (!v.ok) return { error: "AMOUNT_INVALID" as const, arId, reason: v.reason };
    }

    // 3. 创建即取号（拍板④）+ amount = Σ allocations
    const code = await nextWriteOffCode(tx);
    const total = computeWriteOffTotal([...arAmount.values()].map((a) => ({ amount: a })));

    // 4. 创建 WriteOff（DRAFT）+ WriteOffAllocation 明细（不修改 AR）
    const created = await tx.writeOff.create({
      data: {
        code,
        amount: total,
        reason,
        writeOffDate: writeOffDate ? new Date(writeOffDate) : new Date(),
        status: "DRAFT",
        ...(approvalPolicyId !== undefined ? { approvalPolicyId } : {}),
        createdById: user?.id ?? null,
        updatedById: user?.id ?? null,
        allocations: {
          create: [...arAmount.entries()].map(([arId, amt]) => ({
            accountsReceivableId: arId,
            amount: amt,
            createdById: user?.id ?? null,
            updatedById: user?.id ?? null,
          })),
        },
      },
      include: { allocations: true },
    });
    return { writeOff: created, customerId: ars[0].customerId, currency: ars[0].currency };
  });

  if ("error" in result) {
    switch (result.error) {
      case "AR_NOT_FOUND":
        return failNotFound(ERROR_CODES.ACCOUNTS_RECEIVABLE_NOT_FOUND, `应收记录不存在（${result.missingIds.join(",")}）`);
      case "SOURCE_NOT_COMPATIBLE":
        return failConflict(
          ERROR_CODES.WRITE_OFF_SOURCE_NOT_COMPATIBLE,
          `WriteOff 目标 AR 必须同 Customer / 同 Currency（当前 customer=${result.customerCount} 个，currency=${result.currencyCount} 个）`,
        );
      case "AMOUNT_INVALID":
        return fail(ERROR_CODES.WRITE_OFF_AMOUNT_EXCEEDED, `写销金额必须大于 0（AR ${result.arId}）`, 400);
      default:
        return fail(ERROR_CODES.INTERNAL_ERROR, "创建失败：未知错误", 500);
    }
  }

  // 5. 事件 + 审计（事务外，事件失败降级不阻断）
  try {
    await publishWriteOffEvent({
      eventType: "WriteOffCreated",
      actorId: user?.id,
      entityId: result.writeOff.id,
      payload: {
        writeOffId: result.writeOff.id,
        writeOffCode: result.writeOff.code,
        customerId: result.customerId,
        currency: result.currency,
        amount: result.writeOff.amount,
        accountsReceivableIds: result.writeOff.allocations.map((a) => a.accountsReceivableId),
        reason: result.writeOff.reason,
        allocationCount: result.writeOff.allocations.length,
      },
      meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "write-off.create",
      entityType: "write-off",
      entityId: result.writeOff.id,
      afterData: {
        code: result.writeOff.code,
        amount: result.writeOff.amount.toString(),
        reason: result.writeOff.reason,
        status: "DRAFT",
        allocationCount: result.writeOff.allocations.length,
      },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程（DB 事实已在事务内提交）
  }

  return ok({ writeOff: result.writeOff }, undefined, 201);
}

/**
 * GET /api/write-offs（分页 + status/customerId 过滤 + createdAt desc；只读）
 * 只读语义：WriteOff 为独立事实，金额/状态由 submit/apply 事务驱动，无 PATCH。
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "write-off:view");
  if (denied) return denied;
  requestLog(request, user?.id, "write-off.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const status = searchParams.get("status")?.trim();
  const customerId = searchParams.get("customerId")?.trim();

  const where = {
    deletedAt: null,
    ...(status ? { status: status as never } : {}),
    ...(customerId ? { allocations: { some: { accountsReceivable: { customerId } } } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.writeOff.count({ where }),
    prisma.writeOff.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        allocations: {
          where: { deletedAt: null },
          include: {
            accountsReceivable: {
              select: { id: true, invoiceId: true, balanceAmount: true, customerId: true, currency: true },
            },
          },
        },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}
