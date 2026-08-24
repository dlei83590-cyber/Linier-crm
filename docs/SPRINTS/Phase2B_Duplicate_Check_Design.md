# Phase 2B-0 Customer Duplicate Check Design Gate

> 日期：2026-08-24 ｜ CTO Directive Phase 2B-0（纯设计，零 Schema / 零 Migration / 零业务实现）
> 合同原文：「客户查重——关联客户信息表，客户录入重复自动提示。」关键词：客户录入 + 重复 + 自动提示。

---

## 1. 当前 BusinessPartner identity 字段

| 字段 | 类型 | 约束 | 备注 |
|---|---|---|---|
| code | String | @unique | 内部编码（创建即取号） |
| name | String | — | 企业名称 |
| uscc | String? | @unique | 统一社会信用代码（可空；DB 唯一约束已存在） |
| phone | String? | — | 联系电话（主档） |
| email | String? | — | 邮箱 |
| contactPerson | String? | — | 主联系人姓名 |
| type | PartnerType | — | CUSTOMER / SUPPLIER / BOTH（客户/供应商统一主体） |

## 2. 当前创建 API

- `POST /api/business-partners`（apps/web/src/app/api/business-partners/route.ts L89）——创建 BusinessPartner 主档

## 3. 当前 DB unique constraint

- `code` @unique；`uscc` @unique（可空，null 不冲突）
- 结论：USCC 强重复在 DB 层已被 @unique 拦截（P2002）——create guard 需把 P2002 转化为明确 DUPLICATE 提示；查重 API 提供**前置提示**（录入时即发现）

## 4. 是否需要 Schema

**零 Schema / 零 Migration**。查重基于既有 BusinessPartner 字段 + 服务端函数，不建 DuplicateCustomer 表，不新增字段。

## 5. Normalization（共享服务端函数，必须有 unit tests）

- `normalizeUscc(uscc: string): string`——trim + uppercase + 去除合法格式空格（如 `91310000MA1K35L88U`）
- `normalizeCompanyName(name: string): string`——Unicode NFKC + trim + collapse whitespace + Latin case 归一；**不删除「有限公司/集团/科技」等法律名称组成部分**
- `normalizePhone(phone: string): string`——去显示格式字符（空格/`-`/`（）`）；保留明确国家码语义（+86）；**禁止简单截取后 11 位导致误报**
- 位置：`apps/web/src/lib/business-partner/normalize.ts`（+ test）

## 6. Match Algorithm（确定性规则，无模糊/编辑距离/AI）

| 规则 | 输入 | 判定 |
|---|---|---|
| USCC_EXACT | normalizeUscc(input.uscc) == normalizeUscc(existing.uscc)（均非空） | EXACT |
| NAME_EXACT | normalizeCompanyName(input.name) == normalizeCompanyName(existing.name) | POTENTIAL |
| PARTNER_PHONE_EXACT | normalizePhone(input.phone) 非空且 == normalizePhone(existing.phone) | POTENTIAL |
| CONTACT_MOBILE_EXACT | input.contactMobile 非空且 == 任一有效 PartnerContact.mobile/phone（同客户内） | POTENTIAL |

## 7. EXACT / POTENTIAL Semantics

- **EXACT（BLOCKING）**：normalized USCC 精确匹配任意有效 BusinessPartner（含 Supplier-only）→ 创建阻断 409；UI 引导打开已有主体 / 增加 CUSTOMER role（BusinessPartner 是客户/供应商统一主体，不重复创建）
- **POTENTIAL（WARNING）**：名称/电话/联系人手机命中 → 提示用户已有疑似主体；UI 确认（duplicateAcknowledged=true，request-level + Audit）后可继续
- 禁止自动合并 / 覆盖 / 迁移历史事实（detect → explain → prompt → user decision）

## 8. Duplicate Check API

`POST /api/business-partners/duplicate-check`

Request（zod）：`{ name?: string; uscc?: string; phone?: string; contactMobile?: string; contactName?: string; excludePartnerId?: string }`

Response：
```json
{
  "duplicateLevel": "EXACT" | "POTENTIAL" | "NONE",
  "matches": [
    { "id": "bp-1", "code": "BP0001", "name": "某某公司", "roles": ["SUPPLIER"], "phoneMasked": "138****0000", "usccMasked": "9131****88U", "matchReasons": ["USCC_EXACT"] }
  ]
}
```
- Response 最小化：只返回 id/code/name/roles/masked phone/masked USCC/matchReasons/duplicateLevel——查重接口不是客户资料批量泄漏接口；完整资料经 business-partner:view 进详情查看

## 9. Create Guard（Server Create Guard，防 API 直调绕过）

- `POST /api/business-partners` 服务端**重新执行 authoritative duplicate check**（不信任前端）
- 任一 EXACT 命中 → **409**（`DUPLICATE_EXACT`）——不能靠 UI blur 提示兜底
- POTENTIAL 命中：默认允许创建？还是需确认？——设计：**POTENTIAL 允许继续创建，但创建审计记录 POTENTIAL 命中**（避免过度阻断；EXACT 才阻断）。可选 request-level `duplicateAcknowledged=true`（POTENTIAL 时前端确认后附带，写入 Audit）——一期不做成字段持久化
- `excludePartnerId`：编辑现有 BusinessPartner 时排除自身（编辑场景预留）

## 10. UI Automatic Prompt Flow

- 客户新建表单：name / uscc / phone 等关键字段 blur / debounce（≥300ms）→ 调 duplicate-check → 显示匹配卡片（已有主体 + matchReasons + 链接）
- EXACT：阻断提交，引导「查看已有主体 / 增加 CUSTOMER role」
- POTENTIAL：提示「已有疑似主体」，确认后继续（duplicateAcknowledged=true 随创建请求）
- 零匹配：静默（不写 Audit）

## 11. RBAC

- 复用 `business-partner:view`（查重执行 / 查看 match summary）/ `business-partner:create`（创建确认）
- **一期不引入第二套权限模块**；EXACT 不允许业务用户 override（数据合并需另开 Master Data Governance Gate）

## 12. Audit

| 事件 | Audit action | 说明 |
|---|---|---|
| 命中 EXACT | business-partner.duplicate-exact | 记录 input + matched id + reasons |
| 命中 POTENTIAL | business-partner.duplicate-potential | 同上 |
| POTENTIAL 确认继续 | business-partner.duplicate-acknowledged | request-level ack 记录 |
| EXACT 创建被阻断 | business-partner.duplicate-blocked | create guard 409 记录 |
- 无命中 / 键盘 debounce 每次调用**不写 Audit**（防日志污染）

## 13. Error Codes

| Code | 语义 | HTTP |
|---|---|---|
| DUPLICATE_EXACT | 强重复（USCC），创建阻断 | 409 |
| DUPLICATE_REQUIRES_ACK | POTENTIAL 命中未确认（如需强制确认才用） | 409 |

## 14. Test Matrix（CTO §12 14 项）

- 同 USCC → EXACT；大小写/格式不同 USCC → EXACT（normalize 后）；同名称 → POTENTIAL；同企业电话 → POTENTIAL；同联系人手机号 → POTENTIAL；无匹配 → NONE
- 已删除 BusinessPartner（deletedAt 非空）不产生 active duplicate；Supplier-only BP 同 USCC → EXACT 且提示复用主体（不重复建）
- excludePartnerId 不命中自身；EXACT create guard → 409；POTENTIAL 未确认 → 可创建（Audit 记录）；POTENTIAL 已确认 → 可创建（Audit ack）；unauthorized → 403；response 不泄漏非必要字段

## 15. 预计修改文件

| 层 | 文件 |
|---|---|
| 服务端函数 | apps/web/src/lib/business-partner/normalize.ts（+ test） |
| API | apps/web/src/app/api/business-partners/duplicate-check/route.ts；business-partners/route.ts（create guard） |
| UI | apps/web/src/app/(dashboard)/business-partners/new/page.tsx（blur 查重 + 提示 + POTENTIAL 确认） |
| 文档 | test-cases/DuplicateCheck_API.md + QA + CHANGELOG + ROADMAP |

## 16. 冻结边界

- 禁止：Legacy Customer / /api/customers；DuplicateCustomer 表；自动 merge；自动覆盖历史事实；自动迁移销售事实；EXACT override；模糊匹配/AI 相似度；Reservation/MRP；BI；Phase 3
- 零 Schema / 零 Migration（预期结论）
