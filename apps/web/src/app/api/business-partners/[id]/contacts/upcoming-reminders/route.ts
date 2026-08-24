import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok } from "@/lib/api/response";
import { requestLog } from "@/lib/api/logger";
import { computeNextOccurrence, computeRemindAt, isWithinReminderWindow } from "@/lib/contact/helpers";

export const dynamic = "force-dynamic";

/**
 * GET /api/business-partners/:id/contacts/upcoming-reminders
 * —— 即将到期特殊日期提醒（服务端派生：nextOccurrence - remindDaysBefore；禁止前端判断；第一阶段只 Query，不做 fake push）
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-contact:view");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-contact.upcoming-reminders");
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const windowDays = Math.min(Math.max(Number(searchParams.get("windowDays") ?? 30), 1), 365);

  const contacts = await prisma.partnerContact.findMany({
    where: { partnerId: id, deletedAt: null },
    include: { specialDates: { where: { deletedAt: null, reminderEnabled: true } } },
  });

  const now = new Date();
  const reminders: Array<{
    contactId: string;
    contactName: string;
    specialDateId: string;
    type: string;
    title: string | null;
    recurrence: string;
    nextOccurrence: string;
    remindAt: string;
    remindDaysBefore: number;
  }> = [];

  for (const c of contacts) {
    for (const sd of c.specialDates) {
      const nextOccurrence = computeNextOccurrence(sd.date, sd.recurrence, now);
      const remindAt = computeRemindAt(nextOccurrence, sd.remindDaysBefore);
      if (isWithinReminderWindow(remindAt, now, windowDays)) {
        reminders.push({
          contactId: c.id,
          contactName: c.name,
          specialDateId: sd.id,
          type: sd.type,
          title: sd.title,
          recurrence: sd.recurrence,
          nextOccurrence: nextOccurrence.toISOString().slice(0, 10),
          remindAt: remindAt.toISOString().slice(0, 10),
          remindDaysBefore: sd.remindDaysBefore,
        });
      }
    }
  }

  reminders.sort((a, b) => (a.remindAt < b.remindAt ? -1 : 1));
  return ok(reminders);
}
