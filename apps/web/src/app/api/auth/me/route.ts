import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

export async function GET(request: NextRequest) {
  const token = bearerToken(request);

  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: "AUTHENTICATION_ERROR", message: "Missing bearer token" } },
      { status: 401 },
    );
  }

  let payload: Awaited<ReturnType<typeof verifySessionToken>>;
  try {
    payload = await verifySessionToken(token);
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "AUTHENTICATION_ERROR", message: "Invalid or expired token" } },
      { status: 401 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: {
      roles: { include: { role: true } },
    },
  });

  if (!user || !user.isActive) {
    return NextResponse.json(
      { success: false, error: { code: "AUTHENTICATION_ERROR", message: "User not found" } },
      { status: 401 },
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles.map((membership) => membership.role.code),
    },
  });
}
