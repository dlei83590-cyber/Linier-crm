import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, failServer, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { handleServerError } from "@/lib/api/server-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

const contactCreateSchema = z.object({
  name: z.string().min(1).max(100),
  title: z.string().max(100).nullable().optional(),
  department: z.string().max(100).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  mobile: z.string().max(50).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  wechat: z.string().max(100).nullable().optional(),
  contactNote: z.string().max(500).nullable().optional(),
  isPrimary: z.boolean().optional(),
  sort: z.coerce.number().int().min(0).optional(),
});

/** GET /api/business-partners/:id/contacts（联系人列表；partner-contact:view） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-contact:view");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-contact.list");
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const [total, items] = await Promise.all([
    prisma.partnerContact.count({ where: { partnerId: id, deletedAt: null } }),
    prisma.partnerContact.findMany({
      where: { partnerId: id, deletedAt: null },
      orderBy: [{ isPrimary: "desc" }, { sort: "asc" }, { createdAt: "asc" }],
      skip,
      take,
      include: {
        specialDates: { where: { deletedAt: null }, orderBy: { date: "asc" } },
        _count: { select: { relationsAsSource: true, relationsAsTarget: true } },
      },
    }),
  ]);
  return ok(items, { page, pageSize, total });
}

/** POST /api/business-partners/:id/contacts（partner-contact:create；isPrimary 时事务内清除其他主联系人 + partial unique 兜底） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-contact:create");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-contact.create");
  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = contactCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    const created = await prisma.$transaction(async (tx) => {
      const partner = await tx.businessPartner.findFirst({ where: { id, deletedAt: null } });
      if (!partner) throw new Error("PARTNER_INVALID");

      // 主联系人唯一性：isPrimary 时同事务清除其他 active primary（配合 DB partial unique index 兜底）
      if (parsed.data.isPrimary) {
        await tx.partnerContact.updateMany({
          where: { partnerId: id, isPrimary: true, isActive: true, deletedAt: null },
          data: { isPrimary: false, updatedById: user!.id },
        });
      }

      return tx.partnerContact.create({
        data: {
          partnerId: id,
          name: parsed.data.name,
          title: parsed.data.title ?? null,
          department: parsed.data.department ?? null,
          phone: parsed.data.phone ?? null,
          mobile: parsed.data.mobile ?? null,
          email: parsed.data.email ?? null,
          wechat: parsed.data.wechat ?? null,
          contactNote: parsed.data.contactNote ?? null,
          isPrimary: parsed.data.isPrimary ?? false,
          sort: parsed.data.sort ?? 0,
          createdById: user!.id,
          updatedById: user!.id,
        },
      });
    });

    await writeAuditLog({
      actorId: user!.id, action: "partner-contact.create", entityType: "partnerContact",
      entityId: created.id, afterData: { partnerId: id, name: created.name, isPrimary: created.isPrimary }, ...meta,
    });
    return ok(created, undefined, 201);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "P2002") {
      return failConflict(ERROR_CODES.CONTACT_PRIMARY_CONFLICT, "并发设置主联系人冲突，请重试");
    }
    if (err instanceof Error && err.message === "PARTNER_INVALID") {
      return failNotFound(ERROR_CODES.CONTACT_PARTNER_INVALID, "客户不存在");
    }
    return handleServerError(request, user?.id, "partner-contact.create", err);
  }
}
