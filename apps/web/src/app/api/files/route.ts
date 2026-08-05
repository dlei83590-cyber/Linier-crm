import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const fileCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  originalName: z.string().max(255).optional(),
  extension: z.string().max(20).optional(),
  mimeType: z.string().max(100).optional(),
  size: z.number().int().nonnegative().default(0),
  storagePath: z.string().max(500).optional(),
  checksum: z.string().max(128).optional(),
  folderId: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
});

/** GET /api/files（分页 + name/extension/mimeType/folderId 过滤） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file:view");
  if (denied) return denied;
  requestLog(request, user?.id, "file.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const name = searchParams.get("name")?.trim();
  const extension = searchParams.get("extension")?.trim();
  const mimeType = searchParams.get("mimeType")?.trim();
  const folderId = searchParams.get("folderId")?.trim();

  const where = {
    deletedAt: null,
    ...(name ? { name: { contains: name } } : {}),
    ...(extension ? { extension } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(folderId ? { folderId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.file.count({ where }),
    prisma.file.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { folder: { select: { id: true, name: true } } },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/files（创建文件元数据 + 初始版本） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file:create");
  if (denied) return denied;
  requestLog(request, user?.id, "file.create");

  const meta = requestMeta(request);
  const parsed = fileCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  if (parsed.data.folderId) {
    const folder = await prisma.fileFolder.findFirst({ where: { id: parsed.data.folderId, deletedAt: null } });
    if (!folder) return failConflict(ERROR_CODES.NOT_FOUND, "文件夹不存在");
  }

  const existing = await prisma.file.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "文件编码已存在");
  }

  const created = await prisma.$transaction(async (tx) => {
    const file = await tx.file.create({
      data: { ...parsed.data, createdById: user!.id, updatedById: user!.id },
    });
    await tx.fileVersion.create({
      data: {
        fileId: file.id,
        versionNo: 1,
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
    return file;
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "file.create",
    entityType: "file",
    entityId: created.id,
    afterData: { code: created.code, name: created.name, size: created.size },
    ...meta,
  });

  return ok(created, undefined, 201);
}
