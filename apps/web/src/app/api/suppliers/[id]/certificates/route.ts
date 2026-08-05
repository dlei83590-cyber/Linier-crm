import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const certificateCreateSchema = z.object({
  certType: z.string().min(1).max(100),
  certName: z.string().min(1).max(200),
  certNo: z.string().max(100).optional(),
  issueDate: z.string().datetime().optional(),
  expireDate: z.string().datetime().optional(),
  attachment: z.string().max(200).optional(),
});

/** GET /api/suppliers/:id/certificates（证书列表） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier-certificate:view");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier-certificate.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const supplier = await prisma.supplier.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!supplier) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");

  const [total, items] = await Promise.all([
    prisma.supplierCertificate.count({ where: { supplierId: id, deletedAt: null } }),
    prisma.supplierCertificate.findMany({
      where: { supplierId: id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/suppliers/:id/certificates（新增证书） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier-certificate:create");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier-certificate.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = certificateCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const supplier = await prisma.supplier.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!supplier) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");

  const created = await prisma.supplierCertificate.create({
    data: {
      ...parsed.data,
      issueDate: parsed.data.issueDate ? new Date(parsed.data.issueDate) : null,
      expireDate: parsed.data.expireDate ? new Date(parsed.data.expireDate) : null,
      supplierId: id,
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "supplier-certificate.create",
    entityType: "supplier-certificate",
    entityId: created.id,
    meta: { supplierId: id, certName: created.certName, certType: created.certType },
    ...meta,
  });

  return ok(created, undefined, 201);
}
