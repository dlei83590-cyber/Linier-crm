import { NextRequest } from "next/server";
import { pricingEngineService } from "@/lib/pricing/PricingEngineService";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failServer } from "@/lib/api/response";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * Sprint 3C-4 - POST /api/pricing/resolve（价格解析唯一入口，CTO #2249/#2345）
 * 禁止新增 customer/supplier/project 等业务模块自行计算；Quotation/Project/Sales 全部调用本接口。
 */
const resolvePriceSchema = z.object({
  partnerId: z.string().min(1).optional(),
  partnerRole: z.enum(["CUSTOMER", "SUPPLIER", "BOTH", "LOGISTICS", "OUTSOURCING"]).optional(),
  itemId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  pricingDate: z.string().datetime().optional(),
  currency: z.string().min(3).max(10).optional(),
  priceListId: z.string().min(1).optional(),
  policyId: z.string().min(1).optional(),
  region: z.string().max(50).optional(),
  projectId: z.string().min(1).optional(),
  salespersonId: z.string().min(1).optional(),
  uom: z.string().max(20).optional(),
  taxProfileId: z.string().min(1).optional(),
  taxIncluded: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "pricing-engine:view");
  if (denied) return denied;
  requestLog(request, user?.id, "pricing.resolve");

  const meta = requestMeta(request);
  const parsed = resolvePriceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    const result = await pricingEngineService.resolvePrice({
      partnerId: parsed.data.partnerId,
      partnerRole: parsed.data.partnerRole,
      itemId: parsed.data.itemId,
      quantity: parsed.data.quantity,
      pricingDate: parsed.data.pricingDate ? new Date(parsed.data.pricingDate) : new Date(),
      currency: parsed.data.currency ?? "CNY",
      priceListId: parsed.data.priceListId,
      policyId: parsed.data.policyId,
      region: parsed.data.region,
      projectId: parsed.data.projectId,
      salespersonId: parsed.data.salespersonId,
      uom: parsed.data.uom,
      taxProfileId: parsed.data.taxProfileId,
      taxIncluded: parsed.data.taxIncluded,
    });

    await writeAuditLog({
      actorId: user?.id,
      action: "pricing.resolve",
      entityType: "quotationPriceSnapshot",
      entityId: result.snapshotId,
      afterData: {
        itemId: parsed.data.itemId,
        currency: result.currency,
        finalUnitPrice: result.finalUnitPrice.toString(),
        finalAmount: result.finalAmount.toString(),
        source: result.source,
      },
      ...meta,
    });

    return ok(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "ITEM_NOT_FOUND") {
      return failServer("物料不存在或已删除");
    }
    if (message === "PRICE_NOT_FOUND") {
      return failServer("未匹配到有效价格（价目表/专属价均无命中）");
    }
    return failServer("价格解析失败");
  }
}
