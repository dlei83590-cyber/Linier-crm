import { NextResponse } from "next/server";
import { authenticate } from "@/src/lib/auth/jwt";
import { Permission, requirePermission } from "@/src/lib/auth/rbac";
import { withErrorHandler } from "@/src/lib/http/handler";

export const GET = withErrorHandler(async (request) => {
  const principal = await authenticate(request);
  requirePermission(principal, Permission.SYSTEM_READ);
  return NextResponse.json({
    subject: principal.subject,
    permissions: principal.permissions,
  });
});
