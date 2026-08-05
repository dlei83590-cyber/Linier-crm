-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ApprovalMode" AS ENUM ('SEQUENTIAL', 'PARALLEL', 'ANY_ONE', 'COUNTERSIGN');

-- CreateEnum
CREATE TYPE "ApproverType" AS ENUM ('USER', 'ROLE', 'DEPARTMENT', 'APPROVER_GROUP');

-- CreateEnum
CREATE TYPE "WorkflowActionType" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT', 'RETURN', 'TRANSFER', 'DELEGATE', 'WITHDRAW', 'TERMINATE', 'COMMENT');

-- CreateEnum
CREATE TYPE "ConditionOperator" AS ENUM ('EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'IN', 'NOT_IN', 'CONTAINS');

-- CreateEnum
CREATE TYPE "WorkflowInstanceStatus" AS ENUM ('RUNNING', 'COMPLETED', 'REJECTED', 'TERMINATED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ApproverStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DELEGATED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "NotificationChannelType" AS ENUM ('SYSTEM', 'EMAIL', 'TELEGRAM', 'WEBHOOK', 'WECHAT', 'DINGTALK');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ');

-- CreateEnum
CREATE TYPE "SettingScope" AS ENUM ('SYSTEM', 'TENANT', 'USER');

-- CreateEnum
CREATE TYPE "SettingDataType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'JSON', 'SECRET');

-- CreateTable
CREATE TABLE "WorkflowDefinition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStep" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "stepName" TEXT NOT NULL,
    "approverType" "ApproverType" NOT NULL DEFAULT 'USER',
    "approverValue" TEXT,
    "approvalMode" "ApprovalMode" NOT NULL DEFAULT 'SEQUENTIAL',
    "timeoutHours" INTEGER,
    "allowReject" BOOLEAN NOT NULL DEFAULT true,
    "allowTransfer" BOOLEAN NOT NULL DEFAULT false,
    "allowDelegate" BOOLEAN NOT NULL DEFAULT false,
    "allowWithdraw" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "WorkflowStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowCondition" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "expression" TEXT,
    "field" TEXT NOT NULL,
    "operator" "ConditionOperator" NOT NULL,
    "value" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "WorkflowCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowInstance" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "currentStepNo" INTEGER,
    "startedBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3) WITH TIME ZONE,
    "status" "WorkflowInstanceStatus" NOT NULL DEFAULT 'RUNNING',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "WorkflowInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowAction" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "actionType" "WorkflowActionType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "stepNo" INTEGER,
    "comment" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "WorkflowAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowHistory" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "stepNo" INTEGER,
    "actionType" "WorkflowActionType" NOT NULL,
    "beforeStatus" TEXT,
    "afterStatus" TEXT,
    "actorId" TEXT,
    "ip" TEXT,
    "device" TEXT,
    "browser" TEXT,
    "remark" TEXT,
    "attachment" TEXT,
    "duration" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "WorkflowHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approver" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ApproverStatus" NOT NULL DEFAULT 'PENDING',
    "delegatedFrom" TEXT,
    "decidedAt" TIMESTAMP(3) WITH TIME ZONE,
    "comment" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "Approver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApproverGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "ApproverGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApproverGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "ApproverGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDelegate" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    "validTo" TIMESTAMP(3) WITH TIME ZONE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "ApprovalDelegate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalEscalation" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "thresholdHours" INTEGER NOT NULL,
    "escalateToUserId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "ApprovalEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalTimeout" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "timeoutHours" INTEGER NOT NULL,
    "actionOnTimeout" "WorkflowActionType" NOT NULL DEFAULT 'TERMINATE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "ApprovalTimeout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalReminder" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "intervalHours" INTEGER NOT NULL,
    "maxTimes" INTEGER NOT NULL DEFAULT 3,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "ApprovalReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "NotificationChannelType" NOT NULL DEFAULT 'SYSTEM',
    "subject" TEXT,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationMessage" (
    "id" TEXT NOT NULL,
    "templateId" TEXT,
    "recipientUserId" TEXT,
    "channel" "NotificationChannelType" NOT NULL DEFAULT 'SYSTEM',
    "subject" TEXT,
    "content" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3) WITH TIME ZONE,
    "readAt" TIMESTAMP(3) WITH TIME ZONE,
    "error" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "NotificationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channelType" "NotificationChannelType" NOT NULL DEFAULT 'SYSTEM',
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "channel" "NotificationChannelType" NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "payload" JSONB,
    "error" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DictionaryType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "language" TEXT NOT NULL DEFAULT 'zh-CN',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "icon" TEXT,
    "color" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "DictionaryType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DictionaryItem" (
    "id" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "icon" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "DictionaryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "dataType" "SettingDataType" NOT NULL DEFAULT 'STRING',
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSetting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "dataType" "SettingDataType" NOT NULL DEFAULT 'STRING',
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "TenantSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "dataType" "SettingDataType" NOT NULL DEFAULT 'STRING',
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    CONSTRAINT "UserSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinition_code_key" ON "WorkflowDefinition"("code");
CREATE INDEX "WorkflowDefinition_module_idx" ON "WorkflowDefinition"("module");
CREATE INDEX "WorkflowDefinition_status_idx" ON "WorkflowDefinition"("status");
CREATE INDEX "WorkflowDefinition_deletedAt_idx" ON "WorkflowDefinition"("deletedAt");
CREATE UNIQUE INDEX "WorkflowStep_definitionId_stepNo_key" ON "WorkflowStep"("definitionId", "stepNo");
CREATE INDEX "WorkflowStep_definitionId_idx" ON "WorkflowStep"("definitionId");
CREATE INDEX "WorkflowStep_deletedAt_idx" ON "WorkflowStep"("deletedAt");
CREATE INDEX "WorkflowCondition_stepId_idx" ON "WorkflowCondition"("stepId");
CREATE INDEX "WorkflowCondition_deletedAt_idx" ON "WorkflowCondition"("deletedAt");
CREATE UNIQUE INDEX "WorkflowInstance_businessType_businessId_key" ON "WorkflowInstance"("businessType", "businessId");
CREATE INDEX "WorkflowInstance_definitionId_idx" ON "WorkflowInstance"("definitionId");
CREATE INDEX "WorkflowInstance_startedBy_idx" ON "WorkflowInstance"("startedBy");
CREATE INDEX "WorkflowInstance_status_idx" ON "WorkflowInstance"("status");
CREATE INDEX "WorkflowInstance_deletedAt_idx" ON "WorkflowInstance"("deletedAt");
CREATE INDEX "WorkflowAction_instanceId_idx" ON "WorkflowAction"("instanceId");
CREATE INDEX "WorkflowAction_actorId_idx" ON "WorkflowAction"("actorId");
CREATE INDEX "WorkflowAction_deletedAt_idx" ON "WorkflowAction"("deletedAt");
CREATE INDEX "WorkflowHistory_instanceId_idx" ON "WorkflowHistory"("instanceId");
CREATE INDEX "WorkflowHistory_actorId_idx" ON "WorkflowHistory"("actorId");
CREATE INDEX "WorkflowHistory_deletedAt_idx" ON "WorkflowHistory"("deletedAt");
CREATE INDEX "Approver_instanceId_idx" ON "Approver"("instanceId");
CREATE INDEX "Approver_userId_idx" ON "Approver"("userId");
CREATE INDEX "Approver_deletedAt_idx" ON "Approver"("deletedAt");
CREATE UNIQUE INDEX "ApproverGroup_code_key" ON "ApproverGroup"("code");
CREATE INDEX "ApproverGroup_deletedAt_idx" ON "ApproverGroup"("deletedAt");
CREATE UNIQUE INDEX "ApproverGroupMember_groupId_userId_key" ON "ApproverGroupMember"("groupId", "userId");
CREATE INDEX "ApproverGroupMember_groupId_idx" ON "ApproverGroupMember"("groupId");
CREATE INDEX "ApproverGroupMember_deletedAt_idx" ON "ApproverGroupMember"("deletedAt");
CREATE INDEX "ApprovalDelegate_fromUserId_idx" ON "ApprovalDelegate"("fromUserId");
CREATE INDEX "ApprovalDelegate_toUserId_idx" ON "ApprovalDelegate"("toUserId");
CREATE INDEX "ApprovalDelegate_deletedAt_idx" ON "ApprovalDelegate"("deletedAt");
CREATE INDEX "ApprovalEscalation_instanceId_idx" ON "ApprovalEscalation"("instanceId");
CREATE INDEX "ApprovalEscalation_deletedAt_idx" ON "ApprovalEscalation"("deletedAt");
CREATE INDEX "ApprovalTimeout_instanceId_idx" ON "ApprovalTimeout"("instanceId");
CREATE INDEX "ApprovalTimeout_deletedAt_idx" ON "ApprovalTimeout"("deletedAt");
CREATE INDEX "ApprovalReminder_instanceId_idx" ON "ApprovalReminder"("instanceId");
CREATE INDEX "ApprovalReminder_deletedAt_idx" ON "ApprovalReminder"("deletedAt");
CREATE UNIQUE INDEX "NotificationTemplate_code_key" ON "NotificationTemplate"("code");
CREATE INDEX "NotificationTemplate_deletedAt_idx" ON "NotificationTemplate"("deletedAt");
CREATE INDEX "NotificationMessage_recipientUserId_idx" ON "NotificationMessage"("recipientUserId");
CREATE INDEX "NotificationMessage_status_idx" ON "NotificationMessage"("status");
CREATE INDEX "NotificationMessage_deletedAt_idx" ON "NotificationMessage"("deletedAt");
CREATE UNIQUE INDEX "NotificationChannel_code_key" ON "NotificationChannel"("code");
CREATE INDEX "NotificationChannel_deletedAt_idx" ON "NotificationChannel"("deletedAt");
CREATE INDEX "NotificationLog_messageId_idx" ON "NotificationLog"("messageId");
CREATE INDEX "NotificationLog_deletedAt_idx" ON "NotificationLog"("deletedAt");
CREATE UNIQUE INDEX "DictionaryType_code_key" ON "DictionaryType"("code");
CREATE INDEX "DictionaryType_deletedAt_idx" ON "DictionaryType"("deletedAt");
CREATE UNIQUE INDEX "DictionaryItem_typeId_code_key" ON "DictionaryItem"("typeId", "code");
CREATE INDEX "DictionaryItem_typeId_idx" ON "DictionaryItem"("typeId");
CREATE INDEX "DictionaryItem_deletedAt_idx" ON "DictionaryItem"("deletedAt");
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");
CREATE INDEX "SystemSetting_deletedAt_idx" ON "SystemSetting"("deletedAt");
CREATE UNIQUE INDEX "TenantSetting_tenantId_key_key" ON "TenantSetting"("tenantId", "key");
CREATE INDEX "TenantSetting_tenantId_idx" ON "TenantSetting"("tenantId");
CREATE INDEX "TenantSetting_deletedAt_idx" ON "TenantSetting"("deletedAt");
CREATE UNIQUE INDEX "UserSetting_userId_key_key" ON "UserSetting"("userId", "key");
CREATE INDEX "UserSetting_userId_idx" ON "UserSetting"("userId");
CREATE INDEX "UserSetting_deletedAt_idx" ON "UserSetting"("deletedAt");

-- AddForeignKey
ALTER TABLE "WorkflowStep" ADD CONSTRAINT "WorkflowStep_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowCondition" ADD CONSTRAINT "WorkflowCondition_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "WorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowAction" ADD CONSTRAINT "WorkflowAction_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowHistory" ADD CONSTRAINT "WorkflowHistory_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Approver" ADD CONSTRAINT "Approver_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApproverGroupMember" ADD CONSTRAINT "ApproverGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ApproverGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalEscalation" ADD CONSTRAINT "ApprovalEscalation_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalTimeout" ADD CONSTRAINT "ApprovalTimeout_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalReminder" ADD CONSTRAINT "ApprovalReminder_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationMessage" ADD CONSTRAINT "NotificationMessage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "NotificationMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DictionaryItem" ADD CONSTRAINT "DictionaryItem_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "DictionaryType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
