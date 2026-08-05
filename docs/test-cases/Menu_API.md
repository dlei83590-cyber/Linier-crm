# Menu API 测试用例

> Sprint 3B - Menu Center｜分支：feature/sprint3-platform-capabilities
> 用途：自动化测试复用基准，与 docs/qa/Sprint3B_QA.md 配套

## 范围

- Menu / MenuGroup / MenuPermission / RouteMeta（Icon / Sort / Hidden / Cache / ExternalLink）
- 树形结构与排序

## 用例

| # | 场景 | 方法 | 路径 | 权限 | 预期 |
| --- | --- | --- | --- | --- | --- |
| M1 | 菜单列表（树） | GET | /api/menus | menu:view | 200 树结构 |
| M2 | 菜单详情 | GET | /api/menus/:id | menu:view | 200 |
| M3 | 创建菜单 | POST | /api/menus | menu:create | 201 |
| M4 | 更新菜单 | PATCH | /api/menus/:id | menu:edit | 200（乐观锁 version） |
| M5 | 软删除菜单 | DELETE | /api/menus/:id | menu:delete | 200 + deletedAt |
| M6 | 排序调整 | PATCH | /api/menus/:id（sort） | menu:edit | 200 |
| M7 | 隐藏菜单 | PATCH | /api/menus/:id（hidden） | menu:edit | 200 |
| M8 | 外链菜单 | POST | /api/menus（externalLink） | menu:create | 201 |
| M9 | 权限关联 | POST | /api/menus/:id/permissions | menu:assign | 200 |
| M10 | 无权限访问 | GET | /api/menus | 无权限 | 403 |
| M11 | 版本冲突 | PATCH | /api/menus/:id（旧 version） | menu:edit | 409 |

## 验收

- [ ] 全部用例通过
- [ ] 前端可直接读取菜单树
- [ ] CTO 审核
