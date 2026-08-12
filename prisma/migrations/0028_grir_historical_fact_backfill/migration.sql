-- Sprint 5C-1C0（CTO #9547 Review 96/100 Required Readiness Fix）
-- 0028_grir_historical_fact_backfill —— 历史业务事实 GRIR 数据补偿 backfill
--
-- 背景（CTO #9547 Blocking）：C0-B/C 的 GRIR producer 只覆盖"此后发生"的 WHR POST /
-- PurchaseReturn RETURN。但 5B 早于 5C 上线，Migration 0027 部署时数据库可能已存在：
--   WarehouseReceipt.status = POSTED / PurchaseReturn.status = RETURNED
-- 这些历史事实不会重新调用新 route，导致 5C-1C Supplier Invoice POST 引用"旧 WHR"时
-- GrirRecord 表无 ACCRUAL 可 consume —— 业务上有已入库事实、GRIR 无事实的假闭环。
--
-- 本 migration = **数据补偿（backfill），不新增/修改业务模型、不触碰 frozen 0027**。
-- 范围（CTO 拍板）：
--   ① POSTED WarehouseReceiptLine 缺 ACCRUAL → 从 WHR Line→PurchaseReceiptLine→PurchaseOrderLine
--      生成：quantity=WHR qty；unitPrice/taxRate=PO 快照；baseAmount=quantity×unitPrice（未税暂估净额）；
--      sourceKey = 'ACCRUAL:WAREHOUSE_RECEIPT_LINE:{whrLineId}'（与 C0-B 完全同构）。
--   ② RETURNED PurchaseReturnLine（sourceRefType=WAREHOUSE_RECEIPT_LINE）缺 REVERSAL → 生成历史 reversal；
--      remaining unconsumed = ΣACCRUAL - Σ已存在 REVERSAL - 同 WHR Line 先前已分配退货量（窗口累计，**防负 GRIR**）；
--      reversibleQty = min(returnQty, remaining)；仅 > 0 创建；sourceKey = 'REVERSAL:PURCHASE_RETURN_LINE:{prLineId}'。
--      历史无 CONSUME（5C-1C 未上线），因此无需扣除 consume。
--
-- 幂等性（CTO 要求）：全部 INSERT ... SELECT ... WHERE NOT EXISTS + ON CONFLICT(sourceKey) DO NOTHING，
-- 利用既有 GrirRecord_sourceKey_key UNIQUE + 三类 partial UNIQUE 双防线，重复部署零副作用。
-- 审计时间线不失真：createdAt 取源业务事实 postedAt / returnedAt（非 migration 执行时间）；
-- remark 统一 'historical backfill'；createdById 置 NULL（无操作人，backfill 系统行为）。

-- ============ 1. ACCRUAL backfill（历史已 POSTED 入库行 → 补暂估事实）============
INSERT INTO "GrirRecord" (
    "id", "grirType", "supplierInvoiceId", "supplierInvoiceLineId",
    "warehouseReceiptLineId", "purchaseReturnLineId",
    "baseAmount", "quantity", "unitPrice", "taxRate",
    "sourceKey", "remark", "createdById", "createdAt"
)
SELECT
    'accrual-backfill-' || wl."id",          -- 确定性 id（重复执行同源同 id，配合幂等）
    'ACCRUAL',
    NULL,                                     -- source_shape_check：ACCRUAL 时发票列为 NULL
    NULL,
    wl."id",
    NULL,
    ROUND((wl."quantity" * pol."unitPrice")::numeric, 2),  -- 未税暂估净额（P9 Final：不确认 Input VAT）
    wl."quantity",
    pol."unitPrice",                          -- PO 快照单价（暂估基准）
    pol."taxRate",                            -- PO 快照税率
    'ACCRUAL:WAREHOUSE_RECEIPT_LINE:' || wl."id",
    'historical backfill',
    NULL,
    COALESCE(wh."postedAt", wl."createdAt")   -- 审计时间线取源业务事实过账时间
FROM "WarehouseReceiptLine" wl
JOIN "WarehouseReceipt" wh ON wh."id" = wl."warehouseReceiptId"
JOIN "PurchaseReceiptLine" prl ON prl."id" = wl."purchaseReceiptLineId"
JOIN "PurchaseOrderLine" pol ON pol."id" = prl."purchaseOrderLineId"
WHERE wh."status" = 'POSTED'
  AND wl."deletedAt" IS NULL
  AND prl."deletedAt" IS NULL
  AND pol."deletedAt" IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM "GrirRecord" g
      WHERE g."grirType" = 'ACCRUAL' AND g."warehouseReceiptLineId" = wl."id"
  )
ON CONFLICT ("sourceKey") DO NOTHING;

-- ============ 2. REVERSAL backfill（历史已 RETURNED 的 WHR-based 退货 → 补冲减事实）============
-- remaining unconsumed = ΣACCRUAL - Σ已存在 REVERSAL - 同 WHR Line 先前已分配退货量（窗口累计）
-- reversibleQty = min(returnQty, remaining)；remaining ≤ 0 → 不创建（不得制造负 GRIR）
WITH whr_return_lines AS (
    -- 待 backfill 的退货行：RETURNED + WAREHOUSE_RECEIPT_LINE 来源 + 尚无 REVERSAL
    SELECT
        prl."id"                              AS pr_line_id,
        prl."quantity"                        AS return_qty,
        prl."sourceWarehouseReceiptLineId"    AS whr_line_id,
        COALESCE(pr."returnedAt", prl."createdAt") AS fact_time
    FROM "PurchaseReturnLine" prl
    JOIN "PurchaseReturn" pr ON pr."id" = prl."purchaseReturnId"
    WHERE pr."status" = 'RETURNED'
      AND prl."sourceRefType" = 'WAREHOUSE_RECEIPT_LINE'
      AND prl."sourceWarehouseReceiptLineId" IS NOT NULL
      AND prl."deletedAt" IS NULL
      AND pr."deletedAt" IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM "GrirRecord" g
          WHERE g."grirType" = 'REVERSAL' AND g."purchaseReturnLineId" = prl."id"
      )
),
whr_budget AS (
    -- 每个 WHR Line：已 ACCRUAL 总量 + 已存在 REVERSAL 总量（含历史已冲）
    SELECT
        wl."id" AS whr_line_id,
        COALESCE(acc.accrued_qty, 0)  AS accrued_qty,
        COALESCE(rev.reversed_qty, 0) AS existing_reversed_qty
    FROM "WarehouseReceiptLine" wl
    LEFT JOIN LATERAL (
        SELECT SUM(g."quantity") AS accrued_qty
        FROM "GrirRecord" g
        WHERE g."grirType" = 'ACCRUAL' AND g."warehouseReceiptLineId" = wl."id"
    ) acc ON true
    LEFT JOIN LATERAL (
        SELECT SUM(g2."quantity") AS reversed_qty
        FROM "GrirRecord" g2
        JOIN "PurchaseReturnLine" rl2 ON rl2."id" = g2."purchaseReturnLineId"
        WHERE g2."grirType" = 'REVERSAL'
          AND rl2."sourceWarehouseReceiptLineId" = wl."id"
          AND rl2."deletedAt" IS NULL
    ) rev ON true
    WHERE wl."deletedAt" IS NULL
),
allocated AS (
    -- 同 WHR Line 内按 returnedAt/line 顺序累计分配 remaining（窗口累计，防多退货线合计超 ACCRUAL）
    SELECT
        t.pr_line_id,
        t.return_qty,
        t.whr_line_id,
        t.fact_time,
        b.accrued_qty,
        b.existing_reversed_qty,
        SUM(t.return_qty) OVER (
            PARTITION BY t.whr_line_id
            ORDER BY t.fact_time, t.pr_line_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cum_return_qty
    FROM whr_return_lines t
    JOIN whr_budget b ON b.whr_line_id = t.whr_line_id
)
INSERT INTO "GrirRecord" (
    "id", "grirType", "supplierInvoiceId", "supplierInvoiceLineId",
    "warehouseReceiptLineId", "purchaseReturnLineId",
    "baseAmount", "quantity", "unitPrice", "taxRate",
    "sourceKey", "remark", "createdById", "createdAt"
)
SELECT
    'reversal-backfill-' || a.pr_line_id,     -- 确定性 id
    'REVERSAL',
    NULL,
    NULL,
    NULL,                                     -- source_shape_check：REVERSAL 时 WHR 列为 NULL
    a.pr_line_id,
    ROUND((a.reversible_qty * snap.unit_price)::numeric, 2),
    a.reversible_qty,
    snap.unit_price,                          -- 金额口径与对应 ACCRUAL 的 PO 快照一致
    snap.tax_rate,
    'REVERSAL:PURCHASE_RETURN_LINE:' || a.pr_line_id,
    'historical backfill',
    NULL,
    a.fact_time                               -- 审计时间线取源退货单完成时间
FROM (
    SELECT
        a2.*,
        GREATEST(
            LEAST(
                a2.return_qty,
                a2.accrued_qty - a2.existing_reversed_qty - (a2.cum_return_qty - a2.return_qty)
            ),
            0
        ) AS reversible_qty
    FROM allocated a2
) a
LEFT JOIN LATERAL (
    SELECT g."unitPrice" AS unit_price, g."taxRate" AS tax_rate
    FROM "GrirRecord" g
    WHERE g."grirType" = 'ACCRUAL' AND g."warehouseReceiptLineId" = a.whr_line_id
    LIMIT 1
) snap ON true
WHERE a.reversible_qty > 0                    -- 不得制造负 GRIR
  AND snap.unit_price IS NOT NULL             -- 无 ACCRUAL 则无从冲减（fail-safe：跳过）
ON CONFLICT ("sourceKey") DO NOTHING;
