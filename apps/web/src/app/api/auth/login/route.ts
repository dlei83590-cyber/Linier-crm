import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, signSessionToken } from "@/lib/auth";

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

  return NextResponse.json({
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
}
