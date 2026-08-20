# Sprint7 材料成本差异 QA（ADR-0047）

- **日期：** 2026-08-20
- **范围：** 发票净额 vs 暂估价差入 1404（SupplierInvoicePosted GL 映射修正）

| # | 检查项 | 结果 |
| --- | --- | --- |
| S1 | seed +1404 材料成本差异（ASSET/DEBIT） | ✅ |
| S2 | SupplierInvoicePosted：1403=ΣGRIR CONSUME baseAmount；差额入 1404（借/贷按符号） | ✅ |
| S3 | 借贷平衡（1403+1404+222101 = 2202） | ✅ |
| S4 | 无暂估（accrualBase=0）回退原路径（1403=发票净额） | ✅ |
| S5 | 单测：暂估 90 vs 净额 100 → 1403=90 + 1404=10 | ✅ |
| S6 | 既有 SupplierInvoicePosted 测试兼容（mock grirRecord 空） | ✅ |

## 已知限制

1. 差异月末结转/分摊（差异率分配）为 backlog。
2. 仅承接差额；不改 5C 事件载荷与 GRIR 记录。
