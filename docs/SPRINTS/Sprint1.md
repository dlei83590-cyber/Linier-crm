# Sprint 1：Infrastructure（基础设施）✅

**目标：可部署骨架 + 安全边界。**

| 字段 | 值 |
| --- | --- |
| 状态 | ✅ 已完成（PR #3 合并，Release v0.1.0-alpha） |
| 版本 | v0.1.0 |

## 交付内容

- [x] 项目脚手架（web / API / 数据库 / shared 契约）
- [x] 格式化 / lint / 类型检查 / 单测 / 构建命令
- [x] CI：Quality Gates + Secret Scanning + Build + Generate Lockfile
- [x] 认证与会话（JWT via jose、bcrypt）
- [x] 用户 / 部门 / 角色 / 权限 / 用户角色 / 审计日志
- [x] RBAC 在可健康检查的 API 切片上生效
- [x] Railway 部署 + 测试账户 + runbook
- [x] Release v0.1.0-alpha（tag 3b7fd546，Release id 365278518）

## 经验

- 本机禁止 install/build/test，验证靠远程 CI（CTO 规则）
- `pnpm-lock.yaml` 由远程环境生成（Generate Lockfile workflow）
- Railway 部署：pre-deploy 不可靠，startCommand 注入写库脚本可行（fb52fba9）
