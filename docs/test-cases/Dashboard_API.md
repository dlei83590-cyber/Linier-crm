# Dashboard API 测试用例

> Sprint 3B - Dashboard API（不开发页面）｜分支：feature/sprint3-platform-capabilities
> 用途：自动化测试复用基准，与 docs/qa/Sprint3B_QA.md 配套

## 范围

- /api/dashboard/widgets / layouts / kpis / charts
- 仅提供数据 API，页面以后开发

## 用例

| # | 场景 | 方法 | 路径 | 权限 | 预期 |
| --- | --- | --- | --- | --- | --- |
| D1 | Widget 列表 | GET | /api/dashboard/widgets | dashboard:view | 200 |
| D2 | Widget 详情 | GET | /api/dashboard/widgets/:id | dashboard:view | 200 |
| D3 | Widget 创建 | POST | /api/dashboard/widgets | dashboard:create | 201 |
| D4 | Layout 列表 | GET | /api/dashboard/layouts | dashboard:view | 200 |
| D5 | KPI 数据 | GET | /api/dashboard/kpis | dashboard:view | 200 |
| D6 | Chart 数据 | GET | /api/dashboard/charts | dashboard:view | 200 |
| D7 | KPI 按时间范围 | GET | /api/dashboard/kpis?from=&to= | dashboard:view | 200 |
| D8 | 无权限访问 | GET | /api/dashboard/widgets | 无权限 | 403 |
| D9 | 未认证访问 | GET | /api/dashboard/kpis | 无 token | 401 |

## 验收

- [ ] 全部用例通过
- [ ] 不包含页面代码
- [ ] CTO 审核
