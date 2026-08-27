# ADR-0048：中国部署适配（npm registry 镜像 + 时区 + Docker 说明）

- 状态：**Accepted（Implemented，2026-08-20）**
- 日期：2026-08-20
- 维护者：CTO（AI Agent 代理执行）｜审核：CTO
- 关联：CTO_Repo_Audit_2026-08-20（代码审计「中国部署适配」：npm registry 未配镜像 / Docker Hub 国内访问 / TZ）

---

## 决策

1. **.npmrc**：`registry=https://registry.npmmirror.com`（大陆访问 npmjs 慢/超时的主缓解；GitHub CI 如需官方源可在 workflow env 覆盖 `NPM_CONFIG_REGISTRY`）。
2. **docker-compose**：app 与 postgres 均设 `TZ=Asia/Shanghai`（业务日/日志时区；数据存储保持 UTC——与 ADR-0044 时区策略一致）。
3. **部署说明**（README）：Docker Hub 基础镜像（node:22-alpine/postgres:16-alpine）在中国大陆需阿里云/腾讯云镜像加速器；目标云 PostgreSQL 须 ≥16（Migration 0025+ 依赖 UNIQUE NULLS NOT DISTINCT，PolarDB PG15 等不支持）。
4. **Dockerfile 构建 registry**：`ENV COREPACK_NPM_REGISTRY` / `NPM_CONFIG_REGISTRY` 均指向 `https://registry.npmmirror.com`——corepack 下载 pnpm 本体默认仍访问 registry.npmjs.org（.npmrc 不影响 corepack），国内构建会超时；两个 ENV 同时保证 pnpm install 拉包也走镜像。

## 影响

- .npmrc / docker-compose.yml / README（部署章节）/ ADR-0048。
