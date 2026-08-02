import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { getEnvironment } from "@/src/config/env";
import { UnauthorizedError } from "@/src/lib/http/errors";
import { isPermission, type Permission, type Principal } from "./rbac";

interface AccessTokenPayload extends JWTPayload {
  roles: string[];
  permissions: Permission[];
}

function secret(): Uint8Array {
  return new TextEncoder().encode(getEnvironment().JWT_SECRET);
}

function durationInSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) throw new Error("JWT_EXPIRES_IN must use s, m, h, or d units");
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[
    match[2] as "s" | "m" | "h" | "d"
  ];
  return Number(match[1]) * unit;
}

export async function signAccessToken(principal: Principal): Promise<string> {
  const env = getEnvironment();
  return new SignJWT({
    roles: principal.roles,
    permissions: principal.permissions,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(principal.subject)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(
      Math.floor(Date.now() / 1000) + durationInSeconds(env.JWT_EXPIRES_IN),
    )
    .sign(secret());
}

export async function verifyAccessToken(token: string): Promise<Principal> {
  try {
    const env = getEnvironment();
    const { payload } = await jwtVerify<AccessTokenPayload>(token, secret(), {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ["HS256"],
    });
    if (
      !payload.sub ||
      !Array.isArray(payload.roles) ||
      !payload.roles.every((role) => typeof role === "string") ||
      !Array.isArray(payload.permissions) ||
      !payload.permissions.every(isPermission)
    )
      throw new Error("Invalid claims");
    return {
      subject: payload.sub,
      roles: payload.roles,
      permissions: payload.permissions,
    };
  } catch {
    throw new UnauthorizedError("Invalid or expired access token");
  }
}

export async function authenticate(request: Request): Promise<Principal> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) throw new UnauthorizedError();
  return verifyAccessToken(header.slice(7));
}
