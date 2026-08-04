export interface User {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface JWTPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

export interface PasswordHashResult {
  hash: string;
  salt: string;
}
