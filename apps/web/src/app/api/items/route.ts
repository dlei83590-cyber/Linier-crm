import { NextRequest } from "next/server";
import type { ItemType, ItemStatus, ItemLifecycle } from "@prisma/client";
import { hasEffectivePermission } from "@nilier-crm/shared";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";
import { handleServerError } from "@/lib/api/server-error";
import {
  failCategoryResolve,
  isItemWriteAbort,
  ItemWriteAbortError,
  normalizeCategoryName,
  readCategoryAuditSnapshot,
  resolveCategoryIdByName,
  runWithCategoryConflictRetry,
  type CategoryAuditSnapshot,
} from "@/lib/item-category/helpers";

export const dynamic = "force-dynamic";

const itemCreateSchema = z.object({
  code: z.string().min(1).max(64),
  mnemonic: z.string().max(50).optional(),
  name: z.string().min(1).max(200),
  itemType: z.enum(["FINISHED_GOOD", "RAW_MATERIAL", "SEMI_FINISHED", "PURCHASED_PART", "ACCESSORY", "SERVICE", "CONSUMABLE", "ASSET", "TOOLING", "PACKAGING"]).optional(),
  sourcingType: z.enum(["BOUGHT", "SELF_MANUFACTURED", "OEM_OUTSOURCED", "OEM_OUTSOURCED_FULL"]).optional(),
  categoryId: z.string().min(1).optional(),
  // 「类型」自由文本（产品决策）：服务端按名称匹配/新建物料分类并写入 categoryId（不再写 itemType）
  // 长度（trim 后 1..100）与空值语义由 resolveCategoryIdByName 判定，保证中文错误信息可读
  categoryName: z.string().optional(),
  series: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  variant: z.string().max(100).optional(),
  spec: z.string().max(500).optional(),
  brand: z.string().max(100).optional(),
  manufacturer: z.string().max(200).optional(),
  oemCode: z.string().max(100).optional(),
  precisionGrade: z.string().max(50).optional(), // 产品精度等级（技术属性）
  preload: z.string().max(50).optional(), // 预压值（技术属性）
  barcode: z.string().max(100).optional(),
  qrCode: z.string().max(200).optional(),
  drawingNo: z.string().max(100).optional(),
  drawingVersion: z.string().max(50).optional(),
  revision: z.string().max(50).optional(),
  lifecycle: z.enum(["DESIGN", "TRIAL", "MASS_PRODUCTION", "DISCONTINUED", "OBSOLETE"]).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "LOCKED", "ARCHIVED"]).optional(),
  stockUomId: z.string().min(1).optional(),
  purchaseUomId: z.string().min(1).optional(),
  salesUomId: z.string().min(1).optional(),
  isSalable: z.boolean().optional(),
  isPurchasable: z.boolean().optional(),
  isManufacturable: z.boolean().optional(),
  description: z.string().max(1000).optional(),
});

/** GET /api/items（分页 + code/name/itemType/status/categoryId 过滤，Sprint 3C-3 Item Master） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item:view");
  if (denied) return denied;
  requestLog(request, user?.id, "item.list");

  try {

    const { searchParams } = new URL(request.url);
    const { page, pageSize, skip, take } = parsePagination(searchParams);
    const code = searchParams.get("code")?.trim();
    const name = searchParams.get("name")?.trim();
    const itemType = searchParams.get("itemType")?.trim();
    const status = searchParams.get("status")?.trim();
    const categoryId = searchParams.get("categoryId")?.trim();

    const where = {
      deletedAt: null,
      ...(code ? { code: { contains: code } } : {}),
      ...(name ? { name: { contains: name } } : {}),
      ...(itemType ? { itemType: itemType as ItemType } : {}),
      ...(status ? { status: status as ItemStatus } : {}),
      ...(categoryId ? { categoryId } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.item.count({ where }),
      prisma.item.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          // 列表「分类」列展示分类树位置（categoryPath + 名称，用户指令 2026-09-27「重新整理列表字段显示」）
          category: { select: { id: true, code: true, name: true, level: true, categoryPath: true } },
          stockUom: { select: { id: true, code: true, name: true, symbol: true } },
          // 商品采购信息（用户指令 2026-08-21：采购单据选商品自动引用；取优选供应商行）
          supplierItems: {
            where: { deletedAt: null },
            orderBy: [{ isPreferred: "desc" }, { createdAt: "desc" }],
            take: 1,
            select: {
              id: true,
              supplierId: true,
              supplierCode: true,
              purchasePrice: true,
              paymentTerm: true,
              isPreferred: true,
            },
          },
          _count: {
            select: {
              specifications: { where: { deletedAt: null } },
              costs: { where: { deletedAt: null } },
              supplierItems: { where: { deletedAt: null } },
              revisions: { where: { deletedAt: null } },
              tags: { where: { deletedAt: null } },
            },
          },
        },
      }),
    ]);

    return ok(items, { page, pageSize, total });
  } catch (error) {
    return handleServerError(request, user?.id, "item.list", error);
  }

}

/** POST /api/items（创建 Item Master） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item:create");
  if (denied) return denied;
  requestLog(request, user?.id, "item.create");

  const meta = requestMeta(request);
  const parsed = itemCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.item.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "物料编码已存在");
  }

  // 「类型」自由文本 → 物料分类：categoryName 非空时优先于 categoryId（此时忽略请求里的 categoryId）
  const { categoryName, ...itemFields } = parsed.data;
  const requestedCategoryName = categoryName === undefined ? "" : normalizeCategoryName(categoryName);
  // 仅在「未命中已有分类、需要新建」时要求 item-category:create：
  // 这里不额外加 requirePermission，避免把「仅复用已有分类」的既有路径一并拦死
  const canCreateCategory = hasEffectivePermission(user!.permissions, "item-category:create");

  try {
    // 分类解析/新建与 item.create 同事务：解析失败整体回滚，不留孤儿分类
    const { created, autoCreatedCategory } = await runWithCategoryConflictRetry(() =>
      prisma.$transaction(async (tx) => {
        let categoryId = itemFields.categoryId;
        let autoCategory: CategoryAuditSnapshot | null = null;

        if (requestedCategoryName.length > 0) {
          const resolved = await resolveCategoryIdByName(tx, requestedCategoryName, user!.id, canCreateCategory);
          if (!resolved.ok) throw new ItemWriteAbortError({ type: "category", error: resolved.error });
          categoryId = resolved.categoryId;
          if (resolved.created) autoCategory = await readCategoryAuditSnapshot(tx, resolved.categoryId);
        }

        const createdItem = await tx.item.create({
          data: {
            ...itemFields,
            categoryId,
            itemType: itemFields.itemType as ItemType | undefined,
            lifecycle: itemFields.lifecycle as ItemLifecycle | undefined,
            status: itemFields.status as ItemStatus | undefined,
            createdById: user!.id,
            updatedById: user!.id,
          },
        });
        return { created: createdItem, autoCreatedCategory: autoCategory };
      }),
    );

    await writeAuditLog({
      actorId: user?.id,
      action: "item.create",
      entityType: "item",
      entityId: created.id,
      afterData: { code: created.code, name: created.name, itemType: created.itemType },
      ...meta,
    });

    // 确实新建了分类时，额外写一条分类审计（与物料自身审计并存）
    if (autoCreatedCategory) {
      await writeAuditLog({
        actorId: user?.id,
        action: "item-category.create",
        entityType: "item-category",
        entityId: autoCreatedCategory.id,
        afterData: {
          code: autoCreatedCategory.code,
          name: autoCreatedCategory.name,
          categoryPath: autoCreatedCategory.categoryPath,
          level: autoCreatedCategory.level,
          autoCreatedFromItem: true,
        },
        ...meta,
      });
    }

    return ok(created, undefined, 201);
  } catch (error) {
    if (isItemWriteAbort(error) && error.reason.type === "category") {
      return failCategoryResolve(error.reason.error);
    }
    return handleServerError(request, user?.id, "item.create", error);
  }
}