# Phase 2B 客户查重 QA（Vertical Slice：matcher + preflight API + create guard + UI 自动提示）

> 日期：2026-08-25 ｜ CTO FAST TRACK Directive ｜ 验证事实源：GitHub CI + 人工 Runtime Acceptance（AI 不机械勾选）

## 范围

- 共享 normalization（normalizeUscc / normalizeCompanyName / normalizePhone）+ 确定性 matcher（findBusinessPartnerDuplicates）
- POST /api/business-partners/duplicate-check（Preflight；business-partner:create；零业务 Audit）
- POST /api/business-partners Create Guard（USCC normalize → EXACT 阻断 / POTENTIAL ack；P2002 race 按 target 区分；Audit duplicate-blocked/acknowledged）
- UI：新建往来单位页 name/uscc/phone blur + 400ms debounce 查重；EXACT blocking card / POTENTIAL warning card + 确认 checkbox；stale 防护
- 零 Schema / 零 Migration
- 不在范围：自动合并；EXACT override；Legacy Customer；角色转换子系统；2C 公海

## CI 验证（已 PASS）

- 单测：normalize（USCC/公司名/电话）、matcher（EXACT/POTENTIAL/NONE/exclude/deleted/inactive/上限）、create guard route（14-22 + USCC 归一 + 非法 USCC）、duplicate-check route（403/不写 Audit/masked）、前端 UI 逻辑（stale/阻断/ack）
- PR：（待填）Quality/Build/Secret 三闸全绿

## Runtime Acceptance（人工执行，未机械勾选）

> 环境 / build SHA / 执行人 / 日期：（待填）。CTO 指示：Phase 1 + Phase 2A + Phase 2B 同一次最新 Build 一并 Smoke。

| # | 验证项 | 结果 |
|---|---|---|
| RB-1 | 新建无重复客户（名称/USCC 全新）→ 正常创建，无打扰 | [ ] |
| RB-2 | 输入已有企业名称（blur 触发）→ POTENTIAL warning card + 中文理由 | [ ] |
| RB-3 | POTENTIAL 不勾选直接保存 → 前端提示先确认（DUPLICATE_REQUIRES_ACK） | [ ] |
| RB-4 | POTENTIAL 勾选确认保存 → 201 创建成功（Audit 记录 ack） | [ ] |
| RB-5 | 输入已有 USCC → EXACT blocking card，保存被阻断 | [ ] |
| RB-6 | EXACT 命中已归档/删除主体 → 提示「恢复或处理原主体，不能重复新建」 | [ ] |
| RB-7 | Supplier-only USCC 在新建客户时 → EXACT 阻断，提示复用主体并走主数据流程调整角色 | [ ] |
| RB-8 | direct POST（绕过 UI）同 USCC → 仍 409 DUPLICATE_EXACT（Server Guard 兜底） | [ ] |
| RB-9 | direct POST POTENTIAL 未 ack → 409 DUPLICATE_REQUIRES_ACK | [ ] |
| RB-10 | 快速连续修改名称/USCC（stale 防护）→ 展示的是最新输入的查重结果 | [ ] |
| RB-11 | 查重 response 只显示 masked 电话/USCC（无完整值泄漏） | [ ] |
| RB-12 | 无 business-partner:create 权限 → 403（API 直调） | [ ] |

## 边界

- 零 Schema / 零 Migration；零自动合并 / 零 EXACT override；零新 RBAC 模块；零 Legacy Customer；零角色转换子系统
- 查重 API 结果为 NONE 不是创建授权 token——Server Guard 始终最终裁决
