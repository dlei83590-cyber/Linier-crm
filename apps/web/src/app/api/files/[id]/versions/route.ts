import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const versionCreateSchema = z.object({
  originalName: z.string().max(255).optional(),
  extension: z.string().max(20).optional(),
  mimeType: z.string().max(100).optional(),
  size: z.number().int().nonnegative().default(0),
  storagePath: z.string().max(500).optional(),
  checksum: z.string().max(128).optional(),
});

/** GET /api/files/:id/versions（版本历史，分页） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file-version:view");
  if (denied) return denied;
  requestLog(request, user?.id, "file-version.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const file = await prisma.file.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!file) return failNotFound(ERROR_CODES.NOT_FOUND, "文件不存在");

  const [total, items] = await Promise.all([
    prisma.fileVersion.count({ where: { fileId: id, deletedAt: null } }),
    prisma.fileVersion.findMany({
      where: { fileId: id, deletedAt: null },
      orderBy: { versionNo: "desc" },
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/files/:id/versions（新增版本，事务推进 currentVersion） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file-version:create");
  if (denied) return denied;
  requestLog(request, user?.id, "file-version.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = versionCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const created = await prisma.$transaction(async (tx) => {
    const file = await tx.file.findFirst({ where: { id, deletedAt: null } });
    if (!file) return null;
    const nextNo = (await tx.fileVersion.count({ where: { fileId: id } })) + 1;
    const version = await tx.fileVersion.create({
      data: {
        fileId: id,
        versionNo: nextNo,
        originalName: parsed.data.originalName ?? null,
        extension: parsed.data.extension ?? null,
        mimeType: parsed.data.mimeType ?? null,
        size: parsed.data.size ?? 0,
        storagePath: parsed.data.storagePath ?? null,
        checksum: parsed.data.checksum ?? null,
        createdById: user!.id,
        updatedById: user!.id,
      },
    });
    await tx.file.update({
      where: { id },
      data: { currentVersion: nextNo, updatedById: user!.id },
    });
    return version;
  });

  if (!created) return failNotFound(ERROR_CODES.NOT_FOUND, "文件不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "file-version.create",
    entityType: "file-version",
    entityId: created.id,
    meta: { fileId: id, versionNo: created.versionNo },
    ...meta,
  });

  return ok(created, undefined, 201);
}
