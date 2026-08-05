# File API 测试用例

> Sprint 3B - File Center｜分支：feature/sprint3-platform-capabilities
> 用途：自动化测试复用基准，与 docs/qa/Sprint3B_QA.md 配套

## 范围

- File / Attachment / Folder / Version / Preview
- 后续 Quotation / Contract / SO / Invoice / Project 统一引用

## 用例

| # | 场景 | 方法 | 路径 | 权限 | 预期 |
| --- | --- | --- | --- | --- | --- |
| F1 | 文件列表 | GET | /api/files | file:view | 200 |
| F2 | 文件上传 | POST | /api/files | file:create | 201 |
| F3 | 文件下载 | GET | /api/files/:id/download | file:view | 200 |
| F4 | 文件预览 | GET | /api/files/:id/preview | file:view | 200 |
| F5 | 文件版本历史 | GET | /api/files/:id/versions | file:view | 200 |
| F6 | 新版本上传 | POST | /api/files/:id/versions | file:edit | 201 |
| F7 | 文件夹列表 | GET | /api/folders | file:view | 200 |
| F8 | 附件关联业务 | POST | /api/attachments（businessType/businessId） | file:create | 201 |
| F9 | 软删除文件 | DELETE | /api/files/:id | file:delete | 200 |
| F10 | 无权限访问 | GET | /api/files | 无权限 | 403 |
| F11 | 未认证访问 | GET | /api/files | 无 token | 401 |
| F12 | 超大文件限制 | POST | /api/files（超限） | file:create | 400/413 |

## 验收

- [ ] 全部用例通过
- [ ] 业务模块可复用附件引用
- [ ] CTO 审核
