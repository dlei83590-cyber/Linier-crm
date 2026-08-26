import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { casUpdate } from "@/lib/api/cas";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { quotationUpdateSchema } from "@/lib/api/schemas";
import { createQuotationRevision, effectiveStatusOf } from "@/lib/quotation/helpers";
import { publishQuotationEvent } from "@/lib/quotation/events";

export const dynamic = "force-dynamic";

const EDITABLE_STATUSES = ["DRAFT", "REJECTED"] as const;

/** GET /api/quotations/:id（详情含 lines/revisions/snapshots/customer + 惰性过期投影；CC-05 打印只读投影：客户联系/地址/销售负责人 + 行单位） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation:view");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation.get");

  const { id } = await params;
  const quotation = await prisma.quotation.findFirst({
    where: { id, deletedAt: null },
    include: {
      // CC-05 打印视图只读投影（additive）：客户联系/地址 + 当前销售负责人（客户归属 SSOT 派生）
      customer: {
        select: {
          id: true,
          code: true,
          name: true,
          fullName: true,
          contactPerson: true,
          phone: true,
          email: true,
          address: true,
          // 销售负责人 = 客户当前 active ownership 的 owner（CustomerOwnership SSOT，至多一条 active）
          customerOwnerships: {
            where: { releasedAt: null, deletedAt: null },
            select: { owner: { select: { id: true, name: true, email: true } } },
            orderBy: { claimedAt: "desc" },
            take: 1,
          },
        },
      },
      // FRT-06（最小 additive fix）：转换投影随详情返回，报价详情可直接展示已转订单链接
      salesOrder: { select: { id: true, code: true, status: true } },
      lines: {
        where: { deletedAt: null },
        orderBy: { lineNo: "asc" },
        include: {
          item: { select: { id: true, code: true, name: true, model: true, spec: true } },
          priceSnapshot: true,
          uom: { select: { id: true, code: true, name: true, symbol: true } }, // CC-05 打印视图单位列
        },
      },
      revisions: { where: { deletedAt: null }, orderBy: { revisionNo: "desc" } },
      snapshots: { where: { deletedAt: null }, orderBy: { generatedAt: "desc" } },
    },
  });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");

  return ok({ ...quotation, ...effectiveStatusOf(quotation) });
}

/**
 * PATCH /api/quotations/:id（仅 DRAFT/REJECTED 可编辑；乐观锁 version；不直接改 status/行价）
 * 商业内容变更（有效期/税档/备注）→ 系统生成 Revision；发布 QuotationUpdated。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation.update");

  const { id } = await params;
  const parsed = quotationUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, changeReason, ...fields } = parsed.data;
  const meta = requestMeta(request);

  const quotation = await prisma.quotation.findFirst({ where: { id, deletedAt: null } });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");
  if ((EDITABLE_STATUSES as readonly string[]).includes(quotation.status) === false) {
    return failConflict(ERROR_CODES.QUOTATION_NOT_EDITABLE, "仅 DRAFT/REJECTED 状态可编辑");
  }

  // A4-CAS：原子乐观锁置于事务首部（消除 read-check-update TOCTOU）
  const result = await prisma.$transaction(async (tx) => {
    const cas = await casUpdate(tx, "quotation", id, version, {
      ...(fields.validFrom !== undefined ? { validFrom: fields.validFrom ? new Date(fields.validFrom) : null } : {}),
      ...(fields.validUntil !== undefined ? { validUntil: fields.validUntil ? new Date(fields.validUntil) : null } : {}),
      ...(fields.taxProfileId !== undefined ? { taxProfileId: fields.taxProfileId } : {}),
      ...(fields.paymentTerm !== undefined ? { paymentTerm: fields.paymentTerm } : {}),
      ...(fields.remark !== undefined ? { remark: fields.remark } : {}),
      updatedById: user!.id,
    });
    if (cas.outcome !== "OK") return cas;
    const saved = await tx.quotation.findFirst({ where: { id, deletedAt: null } });
    if (!saved) return { outcome: "NOT_FOUND" as const };
    // 商业内容变更 → 系统生成 Revision（不允许自由编辑 Revision）
    await createQuotationRevision(tx, id, changeReason ?? "更新报价单头", { quotation: saved }, user?.id);
    return { outcome: "OK" as const, quotation: saved };
  });
  if (result.outcome === "NOT_FOUND") return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");
  if (result.outcome === "CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = result.quotation;

  await publishQuotationEvent({
    eventType: "QuotationUpdated",
    actorId: user?.id,
    entityId: id,
    payload: {
      quotationId: id,
      quotationCode: updated.code,
      customerId: updated.customerId,
      projectId: updated.projectId,
      workflowInstanceId: updated.workflowInstanceId,
      currency: updated.currency,
      totalAmount: updated.totalAmount,
    },
    meta,
  });
  await writeAuditLog({
    actorId: user?.id,
    action: "quotation.update",
    entityType: "quotation",
    entityId: id,
    afterData: { fields: Object.keys(fields), version: updated.version },
    ...meta,
  });

  return ok({ ...updated, ...effectiveStatusOf(updated) });
}

/** DELETE /api/quotations/:id（仅 DRAFT；软删除 + 级联软删 lines/revisions/snapshots） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const quotation = await prisma.quotation.findFirst({ where: { id, deletedAt: null } });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");
  // 回退管理：仅废弃终态可删除（草稿/已拒绝/已取消——清理列表）；进行中/已生效（提交/批准/发送/接受/已转订单）禁止删除
  if (!["DRAFT", "REJECTED", "CANCELLED"].includes(quotation.status)) {
    return failConflict(ERROR_CODES.QUOTATION_NOT_EDITABLE, "仅 DRAFT/REJECTED/CANCELLED 状态可删除（进行中或已生效报价禁止删除）");
  }
  // 防御：已转换为销售订单（salesOrderId 非空）禁止删除——避免破坏 SO 溯源链
  if (quotation.salesOrderId) {
    return failConflict(ERROR_CODES.QUOTATION_NOT_EDITABLE, "报价已转换为销售订单，禁止删除（保持 SO 溯源）");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.quotation.update({ where: { id }, data: { deletedAt: now, isActive: false, updatedById: user!.id } });
    await tx.quotationLine.updateMany({ where: { quotationId: id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
    await tx.quotationRevision.updateMany({ where: { quotationId: id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
    await tx.quotationSnapshot.updateMany({ where: { quotationId: id, deletedAt: null }, data: { deletedAt: now, isActive: false } });

    // 单号回收：若被删报价为最后一张（序号 == DocumentSequence.nextNo-1），nextNo 回退一位，
    // 下次新建报价复用该单号；updateMany where {id, nextNo} CAS——并发取号已推进则跳过回收（不误回退他人单号）
    const seq = await tx.documentSequence.findFirst({
      where: { docType: "QUOTATION", isActive: true, deletedAt: null },
      select: { id: true, nextNo: true, prefix: true, padLength: true },
    });
    if (seq) {
      const prefix = seq.prefix ?? "QT";
      const numStr = quotation.code.startsWith(prefix) ? quotation.code.slice(prefix.length) : null;
      const parsed = numStr !== null && numStr !== "" && !Number.isNaN(Number(numStr)) ? Number(numStr) : null;
      if (parsed !== null && parsed === seq.nextNo - 1) {
        await tx.documentSequence.updateMany({
          where: { id: seq.id, nextNo: seq.nextNo },
          data: { nextNo: seq.nextNo - 1 },
        });
      }
    }
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "quotation.delete",
    entityType: "quotation",
    entityId: id,
    afterData: { code: quotation.code },
    ...meta,
  });

  return ok({ id, deleted: true });
}
