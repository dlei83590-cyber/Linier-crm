import { NextRequest } from "next/server";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failValidation } from "@/lib/api/response";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";
import { findBusinessPartnerDuplicates } from "@/lib/business-partner/duplicate-check";

export const dynamic = "force-dynamic";

/**
 * POST /api/business-partners/duplicate-check（Phase 2B — 客户查重前置提示）
 *
 * - RBAC：business-partner:create（创建流程的组成部分；不要求额外 view，避免"有创建权限却不能查重"）
 * - 零 Schema / 零 Migration；与 Create Guard 共用同一 matcher（禁止规则漂移）
 * - 不写业务 AuditLog（防 debounce 污染；仅走 request logging，CTO §I）
 * - Response 最小化：只返回 id/code/name/type/isActive/isDeleted/masked phone+uscc/matchReasons/level
 */
const duplicateCheckSchema = z.object({
  name: z.string().max(200).optional(),
  uscc: z.string().max(32).optional(),
  phone: z.string().max(50).optional(),
  contactMobile: z.string().max(50).optional(),
  contactName: z.string().max(100).optional(),
  excludePartnerId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "business-partner:create");
  if (denied) return denied;
  requestLog(request, user?.id, "business-partner.duplicate-check");

  const parsed = duplicateCheckSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const result = await findBusinessPartnerDuplicates({
    name: parsed.data.name,
    uscc: parsed.data.uscc,
    phone: parsed.data.phone,
    contactMobile: parsed.data.contactMobile,
    contactName: parsed.data.contactName,
    excludePartnerId: parsed.data.excludePartnerId,
  });

  return ok(result, undefined, 200);
}
