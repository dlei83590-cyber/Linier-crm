import { SignJWT, jwtVerify } from "jose";
import { hash, compare } from "bcryptjs";
import type { JWTPayload } from "@nilier-crm/types";

const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET ?? "");
const ALG = "HS256";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionClaims {
  sub: string;
  email: string;
  roles: string[];
}

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, 12);
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return compare(plain, hashed);
}

export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ email: claims.email, roles: claims.roles })
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<JWTPayload & { roles?: string[] }> {
  const { payload } = await jwtVerify(token, secret);
  return payload as JWTPayload & { roles?: string[] };
}
