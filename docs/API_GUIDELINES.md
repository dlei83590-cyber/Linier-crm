# API Guidelines（API 统一规范）

- 版本：v1.0
- 日期：2026-08-05
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：[ARCHITECTURE_BASELINE.md](./ARCHITECTURE_BASELINE.md) ｜ [ERROR_CODES.md](./ERROR_CODES.md) ｜ [EVENTS.md](./EVENTS.md) ｜ [openapi.yaml](./openapi.yaml)

> **适用范围**：Sprint 3C 起所有新增 API 必须遵循本规范；存量 API 逐步对齐。
> 所有 API 遵循统一响应/错误格式（见 ARCHITECTURE_BASELINE §4）。

---

## 1. 分页（Pagination）

- 查询参数：`page`（默认 1，从 1 开始）+ `pageSize`（默认 20，上限 100）
- 响应统一携带 `meta`：

```json
{
  "success": true,
  "data": [],
  "meta": { "page": 1, "pageSize": 20, "total": 0 }
}
```

- 实现：统一使用 `parsePagination(searchParams)`（`apps/web/src/lib/api/response.ts`）

## 2. 过滤（Filter）

- 精确匹配：`?status=ACTIVE`、`?enabled=true`
- 模糊匹配：`?name=关键词`（Prisma `contains`，默认不区分大小写）
- 枚举过滤：`?type=PURCHASE`（值必须与枚举一致，非法返回 400 VALIDATION_ERROR）
- 时间范围：`?from=2026-01-01&to=2026-12-31`（ISO 8601）
- 过滤字段白名单：只允许索引字段与高频查询字段，禁止全字段过滤

## 3. 排序（Sort）

- 参数：`?sort=field` 升序、`?sort=-field` 降序（前缀 `-` 表示 DESC）
- 白名单：只允许列表接口声明的排序字段（如 `createdAt`/`updatedAt`/`sort`/`name`）
- 默认排序：列表接口必须声明默认（通常 `createdAt desc` 或 `sort asc`）
- 非法排序字段返回 400 VALIDATION_ERROR，禁止静默忽略

## 4. 搜索（Search）

- 通用搜索：`?q=关键词`（跨多个字段的 contains 检索，接口声明搜索范围）
- 业务编码精确搜索：`?code=xxx`（如物料编码、单据编号）
- 搜索与过滤可组合：`?q=xx&status=ACTIVE&page=1&pageSize=20`

## 5. 批量操作（Batch）

- 批量查询：`GET /api/{resource}?ids=a,b,c`（逗号分隔，上限 100）
- 批量创建/更新/删除（如需要）：`POST /api/{resource}/batch`，Body `{ items: [...] }`
- 批量操作必须整体事务（Prisma `$transaction`），任一失败整体回滚
- 批量响应：`{ success: true, data: { succeeded: [...], failed: [...] } }`

## 6. 导入 / 导出（Import / Export）

- 导出：`GET /api/{resource}/export?format=csv|xlsx`（权限 `{module}:export`）
- 导入：`POST /api/{resource}/import`（multipart 上传，权限 `{module}:import`）
- 导入响应：`{ success: true, data: { total, imported, failed, errors: [{ row, message }] } }`
- 导出文件名：`{resource}-{yyyyMMdd-HHmmss}.{format}`
- 导入模板：`GET /api/{resource}/import/template`（返回空模板）

## 7. 错误码（Error Codes）

- 统一错误响应：`{ "success": false, "error": { "code": "XXX", "message": "..." } }`
- 错误码来源：`ERROR_CODES` 常量（`apps/web/src/lib/api/errors.ts`）+ 全局注册表（ERROR_CODES.md）
- 新业务错误码必须先在 ERROR_CODES.md 注册，禁止散落魔法字符串
- 前端按 code 做国际化与日志统计，message 为人类可读文案

## 8. 版本（Versioning）

- 乐观锁：所有更新必须携带 `version` 字段，与当前值不一致返回 `409 VERSION_CONFLICT`
- 资源版本：`version` 整数，每次更新 +1
- API 路径版本：`/api/v1/...`（当前统一不带版本前缀；引入破坏性变更时升级）

## 9. Headers（请求头规范）

| Header | 必选 | 说明 |
| --- | --- | --- |
| `Authorization: Bearer <token>` | ✅ | JWT 会话令牌 |
| `Content-Type: application/json` | 写操作 | 请求体格式 |
| `X-Request-Id` | 可选 | 客户端请求 ID（服务端透传到 AuditLog） |
| `X-Trace-Id` | 可选 | 全链路追踪 ID（服务端透传到 AuditLog） |
| `Accept-Language` | 可选 | 国际化（预留，默认 zh-CN） |

响应头：

| Header | 说明 |
| --- | --- |
| `X-Request-Id` | 服务端请求 ID（与 AuditLog 一致） |
| `X-RateLimit-Limit` | 限流上限 |
| `X-RateLimit-Remaining` | 剩余额度 |
| `X-RateLimit-Reset` | 重置时间（Unix 秒） |

## 10. Rate Limit（限流）

- 默认：认证用户 300 次/分钟/IP；未认证 20 次/分钟/IP（预留，Sprint 4 前落地）
- 超限返回 `429 TOO_MANY_REQUESTS`，响应头携带额度信息
- 限流维度：IP + 用户 + 资源（可按模块配置）

## 11. Idempotency（幂等）

- 写操作支持幂等键：`Idempotency-Key` 请求头（可选）
- 服务端缓存幂等键（TTL 24h），重复请求返回首次结果，不重复执行
- 创建接口天然幂等字段：`code` 唯一约束（重复返回 409 CONFLICT）
- 业务唯一键：如 `businessType + businessId`（WorkflowInstance）等

## 12. 安全基线

- 所有写操作：Zod 校验 + 后端权限（`{module}:{action}`）+ AuditLog（requestMeta 完整审计）
- 所有读操作：至少 `{module}:view` 权限
- 删除一律软删除（deletedAt），禁止物理删除
- 敏感字段（密码/密钥）：`encrypted=true` 时 API 返回掩码，禁止明文
