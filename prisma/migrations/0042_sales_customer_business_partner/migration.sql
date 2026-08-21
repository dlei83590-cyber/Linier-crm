-- ============================================================
-- 0042 销售链客户重指向：Customer → BusinessPartner（统一往来单位）
-- 背景：销售单据（Quotation/SalesOrder/Delivery/Invoice/AR/Receipt/CDN/InvoiceAdjustment）
--       原 FK 指向遗留 Customer 表；业务主数据为 BusinessPartner（往来单位，ROADMAP：统一往来单位）。
-- 本迁移（v3 修复——Railway 部署 healthcheck 失败根因）：
--   v1: 重指向 UPDATE 在旧 FK 未删除时违反 Quotation_customerId_fkey → 整体回滚
--   v2: 仍可能因 gen_random_uuid()（PG<13 不存在）在回填阶段失败 → v3 改用 md5+random+clock_timestamp（全 PG 版本可用）
-- 执行顺序：
--   1) 为每个无 partnerId 的 Customer 回填 BusinessPartner（code 冲突加后缀）并建立 partnerId 关联
--   2) 先删除 8 张单据的旧 Customer FK（解除约束后再重指向，避免 FK 冲突）
--   3) 将 8 张销售单据 customerId 重指向 BusinessPartner.id
--   4) 防御性孤儿校验（任何残留孤儿 → RAISE EXCEPTION 整体回滚）
--   5) 新增 BusinessPartner FK（ON DELETE RESTRICT ON UPDATE CASCADE）
-- ============================================================

-- 1) 回填 BusinessPartner（DO 块：逐行处理 code 冲突；唯一索引包含软删除行 → 冲突检查覆盖全部行）
DO $$
DECLARE
  c RECORD;
  partnerCode TEXT;
  partnerId TEXT;
  suffix INT;
BEGIN
  FOR c IN SELECT * FROM "Customer" WHERE "partnerId" IS NULL LOOP
    partnerCode := c."code";
    suffix := 0;
    WHILE EXISTS (SELECT 1 FROM "BusinessPartner" WHERE "code" = partnerCode) LOOP
      suffix := suffix + 1;
      partnerCode := c."code" || '-C' || CASE WHEN suffix = 1 THEN '' ELSE suffix::text END;
    END LOOP;
    -- cuid 风格 id：md5(random + clock_timestamp + 行 id)（全 PG 版本可用，不依赖 gen_random_uuid）
    partnerId := 'c' || substr(md5(random()::text || clock_timestamp()::text || c."id"), 1, 24);
    INSERT INTO "BusinessPartner" ("id", "code", "name", "type", "isActive", "approvalStatus", "version", "createdAt", "updatedAt")
    VALUES (partnerId, partnerCode, c."name", 'CUSTOMER', true, 'APPROVED', 1, now(), now());
    UPDATE "Customer" SET "partnerId" = partnerId WHERE "id" = c."id";
  END LOOP;
END $$;

-- 2) 先删除旧 Customer FK（必须在重指向之前，否则 UPDATE customerId → BusinessPartner.id 违反旧 FK）
ALTER TABLE "Quotation" DROP CONSTRAINT IF EXISTS "Quotation_customerId_fkey";
ALTER TABLE "SalesOrder" DROP CONSTRAINT IF EXISTS "SalesOrder_customerId_fkey";
ALTER TABLE "Delivery" DROP CONSTRAINT IF EXISTS "Delivery_customerId_fkey";
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_customerId_fkey";
ALTER TABLE "AccountsReceivable" DROP CONSTRAINT IF EXISTS "AccountsReceivable_customerId_fkey";
ALTER TABLE "Receipt" DROP CONSTRAINT IF EXISTS "Receipt_customerId_fkey";
ALTER TABLE "CreditDebitNote" DROP CONSTRAINT IF EXISTS "CreditDebitNote_customerId_fkey";
ALTER TABLE "InvoiceAdjustment" DROP CONSTRAINT IF EXISTS "InvoiceAdjustment_customerId_fkey";

-- 3) 重指向 8 张销售单据 customerId → 对应 BusinessPartner.id（Customer.partnerId 回填后非空）
UPDATE "Quotation" q SET "customerId" = c."partnerId" FROM "Customer" c WHERE q."customerId" = c."id";
UPDATE "SalesOrder" s SET "customerId" = c."partnerId" FROM "Customer" c WHERE s."customerId" = c."id";
UPDATE "Delivery" d SET "customerId" = c."partnerId" FROM "Customer" c WHERE d."customerId" = c."id";
UPDATE "Invoice" i SET "customerId" = c."partnerId" FROM "Customer" c WHERE i."customerId" = c."id";
UPDATE "AccountsReceivable" a SET "customerId" = c."partnerId" FROM "Customer" c WHERE a."customerId" = c."id";
UPDATE "Receipt" r SET "customerId" = c."partnerId" FROM "Customer" c WHERE r."customerId" = c."id";
UPDATE "CreditDebitNote" n SET "customerId" = c."partnerId" FROM "Customer" c WHERE n."customerId" = c."id";
UPDATE "InvoiceAdjustment" ia SET "customerId" = c."partnerId" FROM "Customer" c WHERE ia."customerId" = c."id";

-- 4) 防御性孤儿校验：重指向后不允许任何残留孤儿 customerId（若有 → 抛错回滚，防止脏数据进入新 FK）
DO $$
DECLARE
  orphanCount BIGINT := 0;
BEGIN
  SELECT count(*) INTO orphanCount FROM "Quotation" q LEFT JOIN "BusinessPartner" bp ON q."customerId" = bp."id" WHERE bp."id" IS NULL;
  SELECT orphanCount + count(*) INTO orphanCount FROM "SalesOrder" s LEFT JOIN "BusinessPartner" bp ON s."customerId" = bp."id" WHERE bp."id" IS NULL;
  SELECT orphanCount + count(*) INTO orphanCount FROM "Delivery" d LEFT JOIN "BusinessPartner" bp ON d."customerId" = bp."id" WHERE bp."id" IS NULL;
  SELECT orphanCount + count(*) INTO orphanCount FROM "Invoice" i LEFT JOIN "BusinessPartner" bp ON i."customerId" = bp."id" WHERE bp."id" IS NULL;
  SELECT orphanCount + count(*) INTO orphanCount FROM "AccountsReceivable" a LEFT JOIN "BusinessPartner" bp ON a."customerId" = bp."id" WHERE bp."id" IS NULL;
  SELECT orphanCount + count(*) INTO orphanCount FROM "Receipt" r LEFT JOIN "BusinessPartner" bp ON r."customerId" = bp."id" WHERE bp."id" IS NULL;
  SELECT orphanCount + count(*) INTO orphanCount FROM "CreditDebitNote" n LEFT JOIN "BusinessPartner" bp ON n."customerId" = bp."id" WHERE bp."id" IS NULL;
  SELECT orphanCount + count(*) INTO orphanCount FROM "InvoiceAdjustment" ia LEFT JOIN "BusinessPartner" bp ON ia."customerId" = bp."id" WHERE bp."id" IS NULL;
  IF orphanCount > 0 THEN
    RAISE EXCEPTION '0042: % orphan customerId row(s) after re-point — migration aborted', orphanCount;
  END IF;
END $$;

-- 5) 新增 BusinessPartner FK（命名沿用 Prisma 默认 Table_column_fkey）
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountsReceivable" ADD CONSTRAINT "AccountsReceivable_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditDebitNote" ADD CONSTRAINT "CreditDebitNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceAdjustment" ADD CONSTRAINT "InvoiceAdjustment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
