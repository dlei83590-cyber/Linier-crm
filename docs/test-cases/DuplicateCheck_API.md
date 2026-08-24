# Duplicate Check API 测试用例（2B 客户查重 Vertical Slice）

> 日期：2026-08-25 ｜ 关联：docs/SPRINTS/Phase2B_Duplicate_Check_Design.md + CTO FAST TRACK Directive §B-§K
> 合同原文：「客户查重——关联客户信息表，客户录入重复自动提示。」
> 权限：duplicate-check 与 create guard 均复用 business-partner:create（CTO §G，不要求额外 view）

## 契约

- POST /api/business-partners/duplicate-check（Preflight 前置提示）
  - Request：{ name?, uscc?, phone?, contactMobile?, contactName?, excludePartnerId? }
  - Response：{ duplicateLevel: EXACT|POTENTIAL|NONE, matches: [{ id, code, name, type, isActive, isDeleted, phoneMasked, usccMasked, matchReasons, level }] }
  - 零业务 Audit（防 debounce 污染；仅 request logging）
- POST /api/business-partners（Create Guard，与 Preflight 共用同一 matcher）
  - USCC：raw → normalizeUscc → GB 32100 校验 → matcher → DB 存 normalized
  - EXACT → 409 DUPLICATE_EXACT（acknowledgement 不能绕过）；soft-deleted 命中提示恢复/处理原主体
  - POTENTIAL 未确认 → 409 DUPLICATE_REQUIRES_ACK；确认（duplicateAcknowledged=true）→ 允许创建 + Audit duplicate-acknowledged
  - P2002 race：uscc → DUPLICATE_EXACT；code → CONFLICT；其他唯一约束 → 500 统一处理

## 匹配规则（确定性，无模糊/AI）

| 规则 | 判定 | 级别 |
|---|---|---|
| USCC_EXACT | normalizeUscc 相等（全库，含 soft-deleted） | EXACT |
| USCC_EXACT_DELETED | 同上且命中主体 deletedAt 非空 | EXACT |
| NAME_EXACT | normalizeCompanyName 相等（deletedAt=null 主体） | POTENTIAL |
| PARTNER_PHONE_EXACT | normalizePhone(BP.phone) 相等 | POTENTIAL |
| CONTACT_PHONE_EXACT | normalizePhone(联系人 phone) 相等（有效联系人） | POTENTIAL |
| CONTACT_MOBILE_EXACT | normalizePhone(联系人 mobile) 相等 | POTENTIAL |

## 用例

| # | 场景 | 预期 |
|---|---|---|
| DC-01 | 同 USCC 普通 exact | EXACT + USCC_EXACT |
| DC-02 | USCC lowercase/space normalization | EXACT（归一后命中） |
| DC-03 | soft-deleted 同 USCC | EXACT + USCC_EXACT_DELETED（提示恢复/处理原主体） |
| DC-04 | same normalized name | POTENTIAL + NAME_EXACT |
| DC-05 | BusinessPartner phone | POTENTIAL + PARTNER_PHONE_EXACT |
| DC-06 | PartnerContact mobile | POTENTIAL + CONTACT_MOBILE_EXACT |
| DC-07 | PartnerContact phone | POTENTIAL + CONTACT_PHONE_EXACT |
| DC-08 | inactive BP potential 仍提示 | POTENTIAL（isActive=false 仍展示） |
| DC-09 | deleted BP name/phone 不产生 POTENTIAL | NONE |
| DC-10 | Supplier-only USCC | EXACT（提示复用主体，不重复建） |
| DC-11 | excludePartnerId 排除自身 | 排除后 NONE |
| DC-12 | 无匹配 | NONE + matches=[] |
| DC-13 | duplicate-check 无 create 权限 | 403 |
| DC-14 | EXACT create | 409 DUPLICATE_EXACT |
| DC-15 | EXACT + acknowledgement | 仍 409 DUPLICATE_EXACT |
| DC-16 | POTENTIAL 无 ack | 409 DUPLICATE_REQUIRES_ACK |
| DC-17 | POTENTIAL + ack | 201 |
| DC-18 | ack creation 写 Audit | business-partner.duplicate-acknowledged（matchedPartnerIds + matchReasons，无敏感原值） |
| DC-19 | preflight 不写业务 Audit | writeAuditLog 未被调用 |
| DC-20 | concurrent USCC P2002 | 409 DUPLICATE_EXACT |
| DC-21 | code P2002 | 409 CONFLICT（不误报为客户重复） |
| DC-22 | response 不泄漏完整电话/USCC | 仅 masked（phoneMasked/usccMasked） |
| DC-23 | UI stale request 不覆盖新结果 | 旧序号响应丢弃（seq guard） |
| DC-24 | UI EXACT 阻断 | 提交被阻断 + blocking card |
| DC-25 | UI POTENTIAL 确认后携带 duplicateAcknowledged=true | 创建请求带 ack |

> 单测证据：apps/web/src/lib/business-partner/normalize.test.ts；duplicate-check.test.ts（matcher）；apps/web/src/app/api/business-partners/route.test.ts（create guard + P2002）；duplicate-check/route.test.ts（403/不写 Audit）；apps/web/src/lib/frontend/duplicate-check.test.ts（UI 逻辑）。
