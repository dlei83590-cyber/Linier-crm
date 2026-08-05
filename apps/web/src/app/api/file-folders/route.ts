import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const folderCreateSchema = z.object({
  code: z.string().min(2).max(64).regex(/^[A-Z0-9_]+$/, "Code 仅允许大写字母、数字、下划线"),
  name: z.string().min(1).max(100),
  parentId: z.string().min(1).optional(),
  sort: z.number().int().default(0),
});

function buildTree(items: { id: string; parentId: string | null }[]) {
  const map = new Map<string, { id: string; parentId: string | null; children: unknown[] } & Record<string, unknown>>();
  const roots: unknown[] = [];
  for (const item of items) map.set(item.id, { ...item, children: [] });
  for (const item of map.values()) {
    if (item.parentId && map.has(item.parentId)) {
      (map.get(item.parentId)!.children as unknown[]).push(item);
    } else {
      roots.push(item);
    }
  }
  return roots;
}

/** GET /api/file-folders（列表或树） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file-folder:view");
  if (denied) return denied;
  requestLog(request, user?.id, "file-folder.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const tree = searchParams.get("tree") === "true";
  const where = { deletedAt: null, isActive: true };

  if (tree) {
    const items = await prisma.fileFolder.findMany({ where, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
    return ok(buildTree(items));
  }

  const [total, items] = await Promise.all([
    prisma.fileFolder.count({ where }),
    prisma.fileFolder.findMany({ where, orderBy: [{ sort: "asc" }, { createdAt: "asc" }], skip, take }),
  ]);
  return ok(items, { page, pageSize, total });
}

/** POST /api/file-folders */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file-folder:create");
  if (denied) return denied;
  requestLog(request, user?.id, "file-folder.create");

  const meta = requestMeta(request);
  const parsed = folderCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  if (parsed.data.parentId) {
    const parent = await prisma.fileFolder.findFirst({ where: { id: parsed.data.parentId, deletedAt: null } });
    if (!parent) return failConflict(ERROR_CODES.NOT_FOUND, "父文件夹不存在");
  }

  const existing = await prisma.fileFolder.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "文件夹编码已存在");
  }

  const created = await prisma.fileFolder.create({
    data: { ...parsed.data, parentId: parsed.data.parentId ?? null, createdById: user!.id, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "file-folder.create",
    entityType: "file-folder",
    entityId: created.id,
    afterData: { code: created.code, name: created.name },
    ...meta,
  });

  return ok(created, undefined, 201);
}
