# Contract Card — 价格表

- 模块：`price-lists`（基础资料 · 价格表）
- 判定：**可开发**（Backend FINAL + Frontend Missing）
- 归属 Wave：F2-2 Wave 1
- 能力（Registry）：list / detail / create / edit（workflow / factActions 无）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                                                                         | 方法     | 说明                        |
| ------- | -------------------------------------------------------------------------------------------- | -------- | --------------------------- |
| List    | `/api/price-lists`                                                                           | GET      | 分页/筛选                   |
| Detail  | `/api/price-lists/{id}`                                                                      | GET      | —                           |
| Create  | `/api/price-lists`                                                                           | POST     | —                           |
| Edit    | `/api/price-lists/{id}`                                                                      | PATCH    | CAS version                 |
| Delete  | `/api/price-lists/{id}`                                                                      | DELETE   | —                           |
| Related | `/api/price-list-versions`、`/api/partner-prices`、`/api/price-policies`、`/api/price-rules` | GET/POST | 版本/伙伴价格/策略/规则子域 |

## Permission

- `price-list:view` / `price-list:create` / `price-list:edit`（动作级权限已 seed）

## Status Machine

- 主数据无审批状态机（版本发布语义以版本子域为准）

## Selectors

- Item（`/api/items`，GET FINAL）
- Business Partner（⚠️ 统一 partner API 缺失，见 HOLD.md；当前可用 `/api/customers`、`/api/suppliers`）

## Error Codes

- 409：version 冲突（并发编辑）

## Current UI

- 占位页（PlaceholderPage「尚未开放」）

## Gap

- 列表/详情/Create/Edit 全部缺失 → F2-2 实现（版本/伙伴价格等子域可后续 Wave 补充）
