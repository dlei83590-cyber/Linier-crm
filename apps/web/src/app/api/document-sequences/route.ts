import { NextRequest } from "next/server";
import type { DocumentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const DOC_TYPES = [
  "QUOTATION", "SALES_ORDER", "PURCHASE_ORDER", "PURCHASE_REQUISITION", "PROFORMA_INVOICE",
  "COMMERCIAL_INVOICE", "DELIVERY_ORDER", "GOODS_RECEIPT_NOTE", "GOODS_ISSUE", "INVOICE",
  "CREDIT_NOTE", "DEBIT_NOTE", "PAYMENT_VOUCHER", "RECEIPT", "WRITE_OFF", "EXPENSE",
  "JOURNAL", "CONTRACT", "PROJECT", "PURCHASE_RECEIPT", "WAREHOUSE_RECEIPT", "PURCHASE_RETURN",
  "INVENTORY_MOVEMENT", "INVENTORY_TRANSFER", "STOCK_COUNT", "INVENTORY_ADJUSTMENT",
  "INVENTORY_CONVERSION", "SUPPLIER_INVOICE",
] as const;

const documentSequenceCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  docType: z.enum(DOC_TYPES),
  prefix: z.string().max(32).nullable().optional(),
  padLength: z.number().int().min(1).max(12).optional(),
});

/** GET /api/document-sequences（分页 + code/name/docType/isActive 过滤） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "document-sequence:view");
  if (denied) return denied;
  requestLog(request, user?.id, "document-sequence.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const docType = searchParams.get("docType")?.trim();
  const isActive = searchParams.get("isActive")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code, mode: "insensitive" as const } } : {}),
    ...(name ? { name: { contains: name, mode: "insensitive" as const } } : {}),
    ...(docType ? { docType: docType as DocumentType } : {}),
    ...(isActive === "true" ? { isActive: true } : isActive === "false" ? { isActive: false } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.documentSequence.count({ where }),
    prisma.documentSequence.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/document-sequences（创建单据序列：code 唯一；nextNo 由编号引擎系统管理，不可客户端写入） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "document-sequence:create");
  if (denied) return denied;
  requestLog(request, user?.id, "document-sequence.create");

  const meta = requestMeta(request);
  const parsed = documentSequenceCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.documentSequence.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "单据序列编码已存在");
  }

  const created = await prisma.documentSequence.create({
    data: {
      code: parsed.data.code,
      name: parsed.data.name,
      docType: parsed.data.docType as DocumentType,
      prefix: parsed.data.prefix ?? null,
      padLength: parsed.data.padLength ?? 4,
      nextNo: 1,
      approvalStatus: "APPROVED",
      createdById: user?.id ?? null,
      updatedById: user?.id ?? null,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "document-sequence.create",
    entityType: "documentSequence",
    entityId: created.id,
    afterData: { code: created.code, name: created.name, docType: created.docType },
    ...meta,
  });

  return ok(created, undefined, 201);
}