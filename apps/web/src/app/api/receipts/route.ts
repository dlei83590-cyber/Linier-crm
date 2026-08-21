import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, parsePagination } from "@/lib/api/response";
import { requestLog } from "@/lib/api/logger";
import { receiptCreateSchema } from "@/lib/api/schemas";
import { nextReceiptCode, createReceiptRevision, createReceiptSnapshot, latestReceiptRevisionNo } from "@/lib/receipt/helpers";
import { publishReceiptEvent } from "@/lib/receipt/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/receipts —— 创建收款单（拍板①：只记录实际收到的钱，**不核销**；status=UNALLOCATED）
 * 拍板④：code DocumentSequence **创建即取号**（RCT-2026-xxxx；Receipt 是实际收款凭证，与 Invoice DRAFT 不占号不同）
 * Create 事务：取号 → 创建 Receipt（amount/allocatedAmount=0/unallocatedAmount=amount）→ Revision → CREATED Snapshot → 事件/审计（事务外）
 * 红线：不自动 Allocation（核销走显式 POST /api/receipts/{id}/allocate）；金额/状态为受控投影，禁止 PATCH。
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "receipt:create");
  if (denied) return denied;
  requestLog(request, user?.id, "receipt.create");

  const parsed = receiptCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { customerId, currency, amount, receiptDate, paymentMethod, referenceNo, changeReason } = parsed.data;
  const meta = requestMeta(request);

  const receipt = await prisma.$transaction(async (tx) => {
    // ── 1. DocumentSequence 创建即取号（拍板④） ──────────────────────────────
    const code = await nextReceiptCode(tx);
    // ── 2. 创建 Receipt（UNALLOCATED；unallocatedAmount = amount） ────────────
    const amountDec = new Prisma.Decimal(amount);
    const created = await tx.receipt.create({
      data: {
        code,
        customerId,
        currency,
        amount: amountDec,
        allocatedAmount: new Prisma.Decimal(0),
        unallocatedAmount: amountDec,
        receiptDate: receiptDate ? new Date(receiptDate) : new Date(),
        paymentMethod: paymentMethod as never,
        ...(referenceNo !== undefined ? { referenceNo } : {}),
        status: "UNALLOCATED",
        createdById: user?.id ?? null,
        updatedById: user?.id ?? null,
      },
    });
    // ── 3. Revision + CREATED Snapshot（Decimal 一律 toString） ───────────────
    const snapshotData = {
      receiptId: created.id,
      code,
      customerId,
      currency,
      amount: amountDec.toString(),
      allocatedAmount: "0",
      unallocatedAmount: amountDec.toString(),
      receiptDate: (receiptDate ? new Date(receiptDate) : new Date()).toISOString(),
      paymentMethod,
      referenceNo: referenceNo ?? null,
      status: "UNALLOCATED",
    };
    await createReceiptRevision(tx, created.id, changeReason ?? "创建收款单", snapshotData, user?.id);
    const revisionNo = await latestReceiptRevisionNo(tx, created.id);
    await createReceiptSnapshot(tx, created.id, "CREATED", revisionNo, snapshotData, user?.id);
    return created;
  });

  // ── 4. 事件 + 审计（事务外，事件失败不阻断——与现有模式一致） ──────────────
  try {
    await publishReceiptEvent({
      eventType: "ReceiptCreated",
      actorId: user?.id,
      entityId: receipt.id,
      payload: {
        receiptId: receipt.id,
        receiptCode: receipt.code,
        customerId: receipt.customerId,
        currency: receipt.currency,
        amount: receipt.amount,
        unallocatedAmount: receipt.unallocatedAmount,
        receiptDate: receipt.receiptDate.toISOString(),
        paymentMethod: receipt.paymentMethod,
        referenceNo: receipt.referenceNo,
      },
      meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "receipt.create",
      entityType: "receipt",
      entityId: receipt.id,
      afterData: {
        code: receipt.code,
        customerId: receipt.customerId,
        currency: receipt.currency,
        amount: receipt.amount.toString(),
        unallocatedAmount: receipt.unallocatedAmount.toString(),
        status: "UNALLOCATED",
      },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程
  }

  // 返回契约对齐其他创建路由：data 直接为 receipt（含 id/code）——前端 apiFetch 取 body.data.id 跳详情
  return ok(receipt, undefined, 201);
}

/**
 * GET /api/receipts（分页 + customerId/status/currency 过滤 + createdAt desc；只读）
 * 只读语义：金额/状态为受控投影，本端点不含任何写操作。
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "receipt:view");
  if (denied) return denied;
  requestLog(request, user?.id, "receipt.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const customerId = searchParams.get("customerId")?.trim();
  const status = searchParams.get("status")?.trim();
  const currency = searchParams.get("currency")?.trim();

  const where = {
    deletedAt: null,
    ...(customerId ? { customerId } : {}),
    ...(status ? { status: status as never } : {}),
    ...(currency ? { currency } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.receipt.count({ where }),
    prisma.receipt.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        customer: { select: { id: true, code: true, name: true } },
        _count: { select: { allocations: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}
