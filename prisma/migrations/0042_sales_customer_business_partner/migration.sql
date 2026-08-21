-- ============================================================
-- 0042 销售链客户重指向：Customer → BusinessPartner（统一往来单位）
-- 背景：销售单据（Quotation/SalesOrder/Delivery/Invoice/AR/Receipt/CDN/InvoiceAdjustment）
--       原 FK 指向遗留 Customer 表；业务主数据为 BusinessPartner（往来单位，ROADMAP：统一往来单位）。
-- 本迁移：
--   1) 为每个无 partnerId 的 Customer 回填 BusinessPartner（code 冲突加后缀）并建立 partnerId 关联
--   2) 将 8 张销售单据 customerId 重指向 BusinessPartner.id
--   3) 删除旧 Customer FK，新增 BusinessPartner FK
-- ============================================================

-- 1) 回填 BusinessPartner（DO 块：逐行处理 code 冲突）
DO $$
DECLARE
  c RECORD;
  partnerCode TEXT;
  partnerId TEXT;
  suffix INT;
BEGIN
  FOR c IN SELECT * FROM "Customer" WHERE "partnerId" IS NULL LOOP
    partnerCode := c."code";
    -- code 冲突处理：追加 -C / -C2 / -C3 … 直到不冲突
    suffix := 0;
    WHILE EXISTS (SELECT 1 FROM "BusinessPartner" WHERE "code" = partnerCode AND "deletedAt" IS NULL) LOOP
      suffix := suffix + 1;
      partnerCode := c."code" || '-C' || CASE WHEN suffix = 1 THEN '' ELSE suffix::text END;
    END LOOP;
    -- 生成 cuid 风格 id（与 Prisma cuid 格式兼容：c + 24 hex）
    partnerId := 'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24);
    INSERT INTO "BusinessPartner" ("id", "code", "name", "type", "isActive", "approvalStatus", "version", "createdAt", "updatedAt")
    VALUES (partnerId, partnerCode, c."name", 'CUSTOMER', true, 'APPROVED', 1, now(), now());
    UPDATE "Customer" SET "partnerId" = partnerId WHERE "id" = c."id";
  END LOOP;
END $$;

-- 2) 重指向 8 张销售单据 customerId → 对应 BusinessPartner.id（Customer.partnerId 回填后非空）
UPDATE "Quotation" q SET "customerId" = c."partnerId" FROM "Customer" c WHERE q."customerId" = c."id";
UPDATE "SalesOrder" s SET "customerId" = c."partnerId" FROM "Customer" c WHERE s."customerId" = c."id";
UPDATE "Delivery" d SET "customerId" = c."partnerId" FROM "Customer" c WHERE d."customerId" = c."id";
UPDATE "Invoice" i SET "customerId" = c."partnerId" FROM "Customer" c WHERE i."customerId" = c."id";
UPDATE "AccountsReceivable" a SET "customerId" = c."partnerId" FROM "Customer" c WHERE a."customerId" = c."id";
UPDATE "Receipt" r SET "customerId" = c."partnerId" FROM "Customer" c WHERE r."customerId" = c."id";
UPDATE "CreditDebitNote" n SET "customerId" = c."partnerId" FROM "Customer" c WHERE n."customerId" = c."id";
UPDATE "InvoiceAdjustment" ia SET "customerId" = c."partnerId" FROM "Customer" c WHERE ia."customerId" = c."id";

-- 3) 删除旧 Customer FK，新增 BusinessPartner FK（命名沿用 Prisma 默认 Table_column_fkey）
ALTER TABLE "Quotation" DROP CONSTRAINT IF EXISTS "Quotation_customerId_fkey";
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesOrder" DROP CONSTRAINT IF EXISTS "SalesOrder_customerId_fkey";
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Delivery" DROP CONSTRAINT IF EXISTS "Delivery_customerId_fkey";
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_customerId_fkey";
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AccountsReceivable" DROP CONSTRAINT IF EXISTS "AccountsReceivable_customerId_fkey";
ALTER TABLE "AccountsReceivable" ADD CONSTRAINT "AccountsReceivable_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Receipt" DROP CONSTRAINT IF EXISTS "Receipt_customerId_fkey";
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreditDebitNote" DROP CONSTRAINT IF EXISTS "CreditDebitNote_customerId_fkey";
ALTER TABLE "CreditDebitNote" ADD CONSTRAINT "CreditDebitNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceAdjustment" DROP CONSTRAINT IF EXISTS "InvoiceAdjustment_customerId_fkey";
ALTER TABLE "InvoiceAdjustment" ADD CONSTRAINT "InvoiceAdjustment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
