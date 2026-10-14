# 部署 / 升级 Runbook（自建机 Docker Compose）

> 适用：`/opt/update-linier.sh` 一类"git pull + docker build + compose up"的自建机部署（非 Railway）。
> 事实基线（来自仓库，2026-09-20）：`Dockerfile` runner 阶段内置 `prisma` CLI 与 `tsx`（可执行 `pnpm db:migrate:prod` / `pnpm db:seed`）；
> `docker-compose.yml` 的 `app` 服务 **没有** `command/entrypoint`，**不会自动执行 migrate/seed**。

---

## 0. 先把部署脚本本身修对（本文件存在的原因）

多数自建机的更新脚本只做了 **migrate**，漏了 **seed**——这正是 2026-09-20 生产事件（升级后管理员导航只剩仪表盘、接口全 403）的根因。
脚本形状通常是：

```bash
cd /opt/<部署目录>
git pull ...
docker compose -f docker-compose.prod.yml up -d --build     # ← 构建 + 起容器
docker compose -f docker-compose.prod.yml exec -T app pnpm db:migrate:prod   # ← 只 migrate
docker compose -f docker-compose.prod.yml ps
```

**必须在 migrate 之后补 seed，并且失败即中止发布**：

```bash
docker compose -f docker-compose.prod.yml exec -T \
  -e SEED_ADMIN_EMAIL="$SEED_ADMIN_EMAIL" -e SEED_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD" \
  app pnpm db:seed || { echo '[deploy] seed 失败，终止发布'; exit 1; }
```

> ⚠️ `db:seed` 会用 `SEED_ADMIN_PASSWORD` **重置该管理员账号密码**（seed 的既有语义）。
> 只想回填权限、不想动密码时：直接执行 §3.1 的 SQL（按角色授予），或先把密码传成当前值。

---

## 1. 标准升级顺序（复制即用）

```bash
# 0) 记录当前版本（出问题可回滚镜像 tag）
git -C /opt/linier-crm log --oneline -1

# 1) 拉取代码
git -C /opt/linier-crm pull --ff-only

# 2) 构建镜像（小机器可能很慢，见 §4）
#    你的脚本内部的 docker build / docker compose build

# 3) ⚠️ 迁移 + seed —— 必须在新容器对外服务之前执行
#    seed 需要管理员凭据环境变量（缺失会 fail-closed 退出，属设计）
docker compose run --rm \
  -e SEED_ADMIN_EMAIL="$SEED_ADMIN_EMAIL" \
  -e SEED_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD" \
  app sh -c "pnpm db:migrate:prod && pnpm db:seed"

# 4) 启动 / 更新容器
docker compose up -d

# 5) 校验（见 §2）
```

> **为什么第 3 步是强制的**：自 ADR-0057 P2/P3 起，运行时鉴权与前端导航**都以数据库角色权限集为唯一权威**（fail-closed）。
> 若数据库里角色权限关联为空，表现是「所有用户无任何权限」——管理员的导航只剩仪表盘、接口全部 403。

---

## 2. 部署后校验清单（两条都必须过）

```bash
# A) 就绪探针：必须 status=ok 且 rbacInitialized=true，
#    并且 rbac.catalogComplete=true、rbac.superAdminComplete=true（见 §2.1）
curl -s http://127.0.0.1:3000/api/health/ready

# B) 角色权限计数（当前期望：SUPER_ADMIN/ADMIN = 1522，MANAGER = 695，MEMBER = 14，VIEWER = 0）
#    管理员数 = 本版本声明的权限码全集（PERMISSIONS ∪ ALL_ACTION_PERMISSIONS ∪ SYSTEM_PERMISSIONS，去重），
#    随模块增加而增长 —— **权威值以探针 rbac.declaredPermissions 与 seed 日志行为准，勿手工推算**。
docker compose exec postgres psql -U nilier -d nilier_crm -c \
 'SELECT r.code, count(rp."A") AS permission_count FROM "Role" r LEFT JOIN "_RolePermissions" rp ON rp."B"=r.id GROUP BY r.code ORDER BY r.code;'
```

- `/api/health/ready` 返回 **503 + `reason=RBAC_NOT_INITIALIZED`** ⇒ 第 3 步没执行或失败 ⇒ 立即补跑 seed（§3 应急）。
- 管理员登录后**只需刷新页面**即可看到新权限（权限在下一次请求/刷新生效，无需重新登录）。

### 2.1 部分 RBAC 陈旧（2026-09-27 生产事件——必须看 `rbac` 字段）

症状：**只有部分接口 403** —— 例如物料「新建/编辑」表单的**分类、供应商**下拉报“无权限访问（403）”，
而物料列表、计量单位、其它模块都正常；**管理员账户（SUPER_ADMIN）同样 403**。

根因：运行时鉴权以 **DB 权限集**为唯一权威（ADR-0057），而该库的 RBAC 数据**落后于代码**：
DB 权限目录缺少后加入的模块权限码（如 `item-category:view` / `supplier:view`），
SUPER_ADMIN 的权限集也停留在旧基线 ⇒ 这些码不在会话有效权限集中 ⇒ 对应接口 fail-closed 403。
仅“至少一个角色持有权限关联”发现不了这种**部分**陈旧，因此探针新增覆盖度字段
（**只报告、不参与 ready 判定**——本端点可能被平台当作运行中容器的健康检查，
若因既有数据陈旧返回 503，会把“部分接口不可用”升级为整站被摘除）。

判定与处置：

| 探针字段 | 含义 | 处置 |
| --- | --- | --- |
| `rbac.catalogComplete=false` | DB 权限目录缺码（`rbac.catalogMissingSample` 给出样本） | 补跑 seed（§3）——**只有 seed 会写权限目录**，只补 `_RolePermissions` 的 SQL 无效 |
| `rbac.superAdminComplete=false` | SUPER_ADMIN 未持有全集（`rbac.superAdminMissingSample` 给出样本） | 补跑 seed（§3 首选）或 §3 次选 SQL |
| `rbac.checked=false` | DB 查询失败，覆盖度未知 | 先解决数据库连通性，**不得**当作“完整” |

> `SUPER_ADMIN` 的权限由系统治理（ADR-0057 裁决 Q2：恒为全集，API 与界面均禁止修改），
> 所以“SUPER_ADMIN 覆盖率不足”一定是**回填/数据**问题，不是有人手工改过权限。

### 2.2 密码策略与强制改密（ADR-0059，Migration 0059）

- Migration 0059 给 `User` 增加 `mustChangePassword`（默认 true）与 `passwordChangedAt`：**存量账号一律 grandfather（false）**，
  升级后老用户不会被强制改密；此后**新建用户**（初始密码固定 `123456`）与**管理员重置过密码**的账号，
  下一次登录会被强制改密（改密前除登录/改密/me/logout 外全部 API 返回 403 `PASSWORD_CHANGE_REQUIRED`）。
- 核对（可选）：

  ```bash
  docker compose exec postgres psql -U nilier -d nilier_crm -c \
   'SELECT email, "mustChangePassword", "passwordChangedAt" FROM "User" ORDER BY "createdAt" DESC LIMIT 20;'
  ```

- 若希望**一次性要求全部历史账号改密**（属治理决策，需单独批准）：

  ```sql
  UPDATE "User" SET "mustChangePassword" = true WHERE "passwordChangedAt" IS NULL;
  ```

---

## 3. 应急恢复：管理员立刻恢复全部权限

**首选**：补跑 seed（幂等；`SUPER_ADMIN` 每次都会对齐为全集）：

```bash
docker compose run --rm -e SEED_ADMIN_EMAIL="$SEED_ADMIN_EMAIL" -e SEED_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD" \
  app pnpm db:seed
```

**先取数据库凭据**（`POSTGRES_USER` 未必是 `nilier`，用应用容器里的真实连接串）：

```bash
docker exec <app容器名> printenv DATABASE_URL     # postgresql://USER:PASS@postgres:5432/DB
```

**次选（无法跑 seed 时的一次性 SQL，幂等）**：把权限目录全集授予 SUPER_ADMIN：

```sql
-- 注意 m2m 列语义：A = Permission.id，B = Role.id
INSERT INTO "_RolePermissions" ("A", "B")
SELECT p.id, r.id
FROM "Permission" p
CROSS JOIN "Role" r
WHERE r.code = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;
```

> 该 SQL 只影响 SUPER_ADMIN（其权限按 ADR-0057 裁决 Q2 本就恒为全集、且 API 禁止修改）。
> 其它内置角色（MANAGER/MEMBER 等）请用 seed 回填，不要手工拼权限集。

---

## 4. 构建很慢（本机 `pnpm build` 数小时）

事实：`next build` 在本仓库要跑全量 ESLint + tsc（`next.config.ts` 显式开启 `eslint.ignoreDuringBuilds=false` / `typescript.ignoreBuildErrors=false`；
约 895 个 TS/TSX、150 页面、390 个 API route）。GitHub CI 同一步约 1.5–2.5 分钟；自建机若耗时两个数量级 ⇒ **机器资源不足**（vCPU/内存/swap）。

只读判读：

```bash
nproc; free -m; uptime; df -h /var/lib/docker
top -bn1 | head -20
dmesg -T | grep -iE "oom|killed process"
```

可选解法（按推荐度）：
1. **镜像在 CI/大机构建后推 registry，部署机只 `pull`**（部署秒级，彻底摆脱小机编译）；
2. 升配构建机（≥4 vCPU / 8GB，另加 swap）；
3. 优化本机构建（BuildKit cache mount：`.next/cache` / `.turbo` / pnpm store；`NODE_OPTIONS=--max-old-space-size=4096`）。

> 不建议通过关闭构建期 lint/type-check 来"提速"：那会削弱发布物自校验（属治理变更，需单独批准）。

---

## 5. 回滚

- 应用层：保留上一版镜像 tag，`docker compose up -d` 指回旧 tag 即可。
- 数据层：本仓库近期变更（RBAC 权限回填等）为**幂等新增行**，**无需回滚 migration**；seed 可重复执行。
