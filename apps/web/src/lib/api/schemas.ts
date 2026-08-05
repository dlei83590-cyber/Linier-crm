import { z } from "zod";

/**
 * Sprint 3A - 统一 Zod Schemas（平台 API）
 * 所有平台 API 参数验证集中于此，禁止散落内联 schema。
 */

// ============================================================================
// Workflow Definition（第一批）
// ============================================================================

export const workflowStatusSchema = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);
export const approvalModeSchema = z.enum(["SEQUENTIAL", "PARALLEL", "ANY_ONE", "COUNTERSIGN"]);
export const approverTypeSchema = z.enum(["USER", "ROLE", "DEPARTMENT", "APPROVER_GROUP"]);
export const conditionOperatorSchema = z.enum(["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "IN", "NOT_IN", "CONTAINS"]);

export const workflowConditionSchema = z.object({
  expression: z.string().max(200).optional(),
  field: z.string().min(1).max(100),
  operator: conditionOperatorSchema,
  value: z.string().min(1).max(200),
});

export const workflowStepSchema = z.object({
  stepNo: z.number().int().positive(),
  stepName: z.string().min(1).max(100),
  approverType: approverTypeSchema,
  approverValue: z.string().min(1).max(100).optional(),
  approvalMode: approvalModeSchema.default("SEQUENTIAL"),
  timeoutHours: z.number().int().positive().optional(),
  allowReject: z.boolean().default(true),
  allowTransfer: z.boolean().default(false),
  allowDelegate: z.boolean().default(false),
  allowWithdraw: z.boolean().default(false),
  conditions: z.array(workflowConditionSchema).default([]),
});

export const workflowDefinitionCreateSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[A-Z0-9_]+$/, "Code 仅允许大写字母、数字、下划线"),
  name: z.string().min(1).max(100),
  module: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  steps: z.array(workflowStepSchema).min(1, "至少需要一个步骤"),
});

export const workflowDefinitionUpdateSchema = workflowDefinitionCreateSchema
  .partial()
  .extend({ version: z.number().int().positive() });

// ============================================================================
// Workflow Instance（第二批）
// ============================================================================

export const workflowInstanceStatusSchema = z.enum(["RUNNING", "COMPLETED", "REJECTED", "TERMINATED", "WITHDRAWN"]);
export const workflowActionTypeSchema = z.enum([
  "SUBMIT",
  "APPROVE",
  "REJECT",
  "RETURN",
  "TRANSFER",
  "DELEGATE",
  "WITHDRAW",
  "TERMINATE",
  "COMMENT",
]);

export const workflowInstanceCreateSchema = z.object({
  definitionId: z.string().min(1),
  businessType: z.string().min(1).max(50),
  businessId: z.string().min(1).max(100),
  payload: z.record(z.unknown()).optional(), // 业务字段（用于条件评估，如 amount）
});

export const workflowActionSchema = z.object({
  actionType: workflowActionTypeSchema,
  targetUserId: z.string().min(1).optional(), // TRANSFER/DELEGATE 目标
  stepNo: z.number().int().positive().optional(),
  comment: z.string().max(1000).optional(),
  payload: z.record(z.unknown()).optional(),
});

// ============================================================================
// 第三批：平台配置
// ============================================================================

export const approverGroupCreateSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[A-Z0-9_]+$/, "Code 仅允许大写字母、数字、下划线"),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  memberUserIds: z.array(z.string().min(1)).default([]),
});

export const approverGroupUpdateSchema = approverGroupCreateSchema.partial().extend({
  version: z.number().int().positive(),
});

export const dictionaryTypeCreateSchema = z.object({
  code: z.string().min(2).max(64),
  name: z.string().min(1).max(100),
  category: z.string().max(50).optional(),
  language: z.string().max(20).default("zh-CN"),
  sort: z.number().int().default(0),
  icon: z.string().max(100).optional(),
  color: z.string().max(20).optional(),
  enabled: z.boolean().default(true),
});

export const dictionaryTypeUpdateSchema = dictionaryTypeCreateSchema.partial().extend({
  version: z.number().int().positive(),
});

export const dictionaryItemCreateSchema = z.object({
  code: z.string().min(1).max(64),
  label: z.string().min(1).max(100),
  sort: z.number().int().default(0),
  color: z.string().max(20).optional(),
  icon: z.string().max(100).optional(),
  enabled: z.boolean().default(true),
});

export const dictionaryItemUpdateSchema = dictionaryItemCreateSchema.partial().extend({
  version: z.number().int().positive(),
});

export const settingScopeSchema = z.enum(["SYSTEM", "TENANT", "USER"]);
export const settingDataTypeSchema = z.enum(["STRING", "NUMBER", "BOOLEAN", "JSON", "SECRET"]);

export const settingCreateSchema = z.object({
  scope: settingScopeSchema,
  tenantId: z.string().min(1).optional(), // scope=TENANT 必填
  userId: z.string().min(1).optional(), // scope=USER 必填
  key: z.string().min(1).max(100),
  value: z.string().max(4000).optional(),
  dataType: settingDataTypeSchema.default("STRING"),
  encrypted: z.boolean().default(false),
  description: z.string().max(500).optional(),
});

export const settingUpdateSchema = settingCreateSchema.partial().extend({
  version: z.number().int().positive(),
});

export const notificationChannelTypeSchema = z.enum(["SYSTEM", "EMAIL", "TELEGRAM", "WEBHOOK", "WECHAT", "DINGTALK"]);

export const notificationTemplateCreateSchema = z.object({
  code: z.string().min(2).max(64),
  name: z.string().min(1).max(100),
  channel: notificationChannelTypeSchema.default("SYSTEM"),
  subject: z.string().max(200).optional(),
  content: z.string().min(1).max(4000),
});

export const notificationTemplateUpdateSchema = notificationTemplateCreateSchema.partial().extend({
  version: z.number().int().positive(),
});
