export const APP_NAME = "Linier CRM Management System";

export const APP_VERSION = "v0.1.0-alpha";

export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
} as const;

export const PERMISSIONS = {
  USER_READ: "user:read",
  USER_WRITE: "user:write",
  ROLE_READ: "role:read",
  ROLE_WRITE: "role:write",
  AUDIT_READ: "audit:read",
  AUDIT_WRITE: "audit:write",
} as const;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
