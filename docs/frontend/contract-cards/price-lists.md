# Contract Card — 价格表

- 模块：`price-lists`（基础资料 · 价格表）
- 判定：**Ready（F2-2 Wave 1 已交付）**（Backend FINAL + Frontend Existing）
- 归属 Wave：F2-2 Wave 1
- Backend Contract：list / detail / create / edit / ~workflow / ~factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：list / detail / create / edit / ~workflow / ~factActions（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD）

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

## Frontend Current State（ui 层事实，2026-08-14）

| 能力              | 状态                           |
| ----------------- | ------------------------------ |
| List              | ⏸️ 未开放（占位页/入口未开放） |
| Detail            | ⏸️ 未开放（占位页/入口未开放） |
| Create            | ⏸️ new 页面未入 main           |
| Edit              | ⏸️ edit 页面未入 main          |
| Submit / Workflow | HOLD（Tier 2 HARD HOLD）       |
| Fact Actions      | HOLD（Tier 3 HARD HOLD）       |

## Current UI

- 真实列表页（EntityListWorkspace）+ 详情页（EntityDetailWorkspace + 价格条目 + 审计）+ 新建/编辑表单（EntityFormWorkspace + ReferenceSelector + CAS version）

- 占位页（PlaceholderPage「尚未开放」）

## Gap

- - 无剩余 Gap；版本/伙伴价格等子域页面按后续 Wave 规划
- UX Hardening（CTO #11660）：Dirty-State Guard（useDirtyStateGuard）+ 409 CAS 冲突专用面板（isVersionConflict + 重新加载）已接入

- 列表/详情/Create/Edit 全部缺失 → F2-2 实现（版本/伙伴价格等子域可后续 Wave 补充）
