import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { handleServerError } from "@/lib/api/server-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

const specialDateCreateSchema = z.object({
  type: z.enum(["BIRTHDAY", "ANNIVERSARY", "OTHER"]),
  date: z.string(), // YYYY-MM-DD
  recurrence: z.enum(["NONE", "YEARLY"]).optional(),
  title: z.string().max(200).nullable().optional(),
  remindDaysBefore: z.coerce.number().int().min(0).max(365).optional(),
  reminderEnabled: z.boolean().optional(),
});

function defaultRecurrence(type: string): "NONE" | "YEARLY" {
  return type === "BIRTHDAY" || type === "ANNIVERSARY" ? "YEARLY" : "NONE";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; contactId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-contact:view");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-contact.special-dates.list");
  const { contactId } = await params;
  const items = await prisma.contactSpecialDate.findMany({ where: { contactId, deletedAt: null }, orderBy: { date: "asc" } });
  return ok(items);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; contactId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-contact:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-contact.special-dates.create");
  const { id, contactId } = await params;
  const meta = requestMeta(request);
  const parsed = specialDateCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    const contact = await prisma.partnerContact.findFirst({ where: { id: contactId, partnerId: id, deletedAt: null } });
    if (!contact) return failNotFound(ERROR_CODES.CONTACT_NOT_FOUND, "联系人不存在");

    const dateStr = parsed.data.date;
    const dateMatch = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
    if (!dateMatch || Number.isNaN(new Date(dateStr + "T00:00:00").getTime())) {
      return failValidation({ date: "日期格式必须为 YYYY-MM-DD" });
    }

    const created = await prisma.contactSpecialDate.create({
      data: {
        contactId,
        type: parsed.data.type,
        date: new Date(dateStr + "T00:00:00"),
        recurrence: parsed.data.recurrence ?? defaultRecurrence(parsed.data.type),
        title: parsed.data.title ?? null,
        remindDaysBefore: parsed.data.remindDaysBefore ?? 0,
        reminderEnabled: parsed.data.reminderEnabled ?? true,
        createdById: user!.id,
        updatedById: user!.id,
      },
    });
    await writeAuditLog({
      actorId: user!.id, action: "partner-contact.special-date.create", entityType: "contactSpecialDate",
      entityId: created.id, afterData: { contactId, type: created.type, date: dateStr, recurrence: created.recurrence }, ...meta,
    });
    return ok(created, undefined, 201);
  } catch (err) {
    return handleServerError(request, user?.id, "partner-contact.special-dates.create", err);
  }
}
