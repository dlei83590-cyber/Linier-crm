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
  ITEM_READ: "item:read",
  ITEM_WRITE: "item:write",
  BUSINESS_PARTNER_READ: "business-partner:read",
  BUSINESS_PARTNER_WRITE: "business-partner:write",
  PRICE_LIST_READ: "price-list:read",
  PRICE_LIST_WRITE: "price-list:write",
  TECHNICAL_STANDARD_READ: "technical-standard:read",
  TECHNICAL_STANDARD_WRITE: "technical-standard:write",
  UNIT_OF_MEASURE_READ: "unit-of-measure:read",
  UNIT_OF_MEASURE_WRITE: "unit-of-measure:write",
  COMMERCIAL_TERM_READ: "commercial-term:read",
  COMMERCIAL_TERM_WRITE: "commercial-term:write",
  DOCUMENT_SEQUENCE_READ: "document-sequence:read",
  DOCUMENT_SEQUENCE_WRITE: "document-sequence:write",
  PROJECT_OPPORTUNITY_READ: "project-opportunity:read",
  PROJECT_OPPORTUNITY_WRITE: "project-opportunity:write",
  PROJECT_READ: "project:read",
  PROJECT_WRITE: "project:write",
  PROJECT_VISIT_READ: "project-visit:read",
  PROJECT_VISIT_WRITE: "project-visit:write",
  PROJECT_RISK_READ: "project-risk:read",
  PROJECT_RISK_WRITE: "project-risk:write",
} as const;

/** 主数据模块（供菜单/权限路由复用） */
export const MASTER_DATA_MODULES = [
  "item",
  "business-partner",
  "price-list",
  "technical-standard",
  "unit-of-measure",
  "commercial-term",
  "document-sequence",
] as const;

/** 项目领域模块（供菜单/权限路由复用） */
export const PROJECT_MODULES = [
  "project-opportunity",
  "project",
  "project-visit",
  "project-risk",
] as const;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
