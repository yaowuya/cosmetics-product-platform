# 化妆品企业产品展示平台 V1 · 任务计划总览

## Canonical End Entrypoints

| End | Canonical entrypoint | Mode |
| --- | --- | --- |
| Backend | [`tasks/plan-backend.md`](plan-backend.md) | small |
| Frontend | [`tasks/frontend/00-index.md`](frontend/00-index.md) | split |

## Cross-end Dependency Edges

箭头从前置任务指向使用其交付结果的任务。端内依赖以各任务的 Depends on 为准。

| From task | To task | Shared contract / gate |
| --- | --- | --- |
| `backend-002` | `frontend-002` | 用当前会话约束登录、改密与后台写入 |
| `backend-003` | `frontend-002` | 分开账号管理、发布授权和审计可见范围 |
| `backend-005` | `frontend-003` | 以稳定节点配置四页与企业目录 |
| `backend-006` | `frontend-003` | 按修订预览草稿并私有读取不可变素材 |
| `backend-004` | `frontend-004` | 每款一行地维护独立产品和案例草稿 |
| `backend-010` | `frontend-004` | 提示受影响案例并安全下架、删除或归档 |
| `backend-008` | `frontend-005` | 用同一规则检查单条和所选产品 |
| `backend-009` | `frontend-005` | 每款确认只提交一次完整快照和回执 |
| `backend-012` | `frontend-006` | 仅投影公开四页、有效目录、产品与独立案例 |
| `backend-013` | `frontend-006` | 最后公开引用解除后旧图片链接立即失效 |
| `backend-006` | `frontend-007` | 仅编辑可用的指定修订预览及绑定引用的私有图；旧响应不得接管当前画面 |
| `backend-009` | `frontend-007` | 每款确认只提交一次完整快照和回执 |
| `backend-011` | `frontend-008` | 编辑将指定历史版本恢复为草稿而不发布 |
| `backend-007` | `frontend-009` | 仅为选中且改变位置的产品生成草稿 |
| `backend-008` | `frontend-009` | 用同一规则检查单条和所选产品 |
| `backend-009` | `frontend-009` | 每款确认只提交一次完整快照和回执 |
| `backend-003` | `frontend-010` | 分开账号管理、发布授权和审计可见范围 |
| `backend-010` | `frontend-010` | 提示受影响案例并安全下架、删除或归档 |
| `backend-016` | `frontend-011` | 从第二企业空实例和异机恢复证明交付可重复 |

## Progress Totals

| End | Total | Complete | Remaining |
| --- | ---: | ---: | ---: |
| Backend | 16 | 14 | 2 |
| Frontend | 11 | 1 | 10 |
