import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, signSessionToken, SESSION_COOKIE_NAME, SESSION_COOKIE_MAX_AGE_SECONDS } from "@/lib/auth";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(request: NextRequest) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      roles: { include: { role: true } },
    },
  });

  if (!user || !user.isActive) {
    return NextResponse.json(
      { success: false, error: { code: "AUTHENTICATION_ERROR", message: "Invalid credentials" } },
      { status: 401 },
    );
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    return NextResponse.json(
      { success: false, error: { code: "AUTHENTICATION_ERROR", message: "Invalid credentials" } },
      { status: 401 },
    );
  }

  const roles = user.roles.map((membership) => membership.role.code);
  const token = await signSessionToken({ sub: user.id, email: user.email, roles });

  const res = NextResponse.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles,
      },
    },
  });
  // ADR-0045：httpOnly SameSite=Lax 会话 cookie（前端不再存 localStorage；Lax 阻断跨站 POST CSRF）
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}
