# FeaturePilot Manifest

本文件是项目规范和验证资料的索引。按当前任务查阅相关条目；列出的可选文件不一定已创建。

Schema: fp-manifest/v2
Generated: 2026-11-22T14:46:30Z
Project root: `.`
FP docs root: `fp-docs/`
Git SHA: `15e5d772fc5e3a057e9661862914f8698692652b`
Working tree: dirty

## Precedence

当前行为以源码和实际命令输出为准。目标要求以本轮用户指令和已批准的变更文档为准。

## Settings Files

| File | Role | Authoritative For | When To Read | Status |
| --- | --- | --- | --- | --- |
| `settings/agent.md` | 工作流约定 | 通用约束和外部文档索引 | 处理流程或策略问题时 | missing |
| `settings/frontend.md` | 前端设置 | 页面实现和视觉验收 | 前端页面或原型任务 | present |
| `settings/backend.md` | 后端设置 | 接口、数据和权限 | 后端实现或验收 | present |
| `settings/code-standards.md` | 项目专属规范 | 已登记的应用规则 | 适用端将此文件登记为规则来源时 | missing |
| `settings/prototype-style.md` | 原型样式参考 | 原型视觉一致性 | 生成原型时 | missing |

## Code Map

| Provider | Status | Version | Index Path | Last Checked | Use As |
| --- | --- | --- | --- | --- | --- |
| CodeGraph | skipped | not-checked | `.codegraph/` | 2026-11-22 | navigation-hint-only |

## Intel Artifacts

| File | Purpose | When To Read | Freshness | Sources |
| --- | --- | --- | --- | --- |
| `intel/project-facts.md` | 项目事实缓存 | 查找验证要求或非显然的约束时 | missing | 已批准的只读调查 |
| `intel/.freshness.json` | 缓存元数据 | 核对事实缓存是否仍适用时 | missing | 随事实缓存生成 |
| `intel/unknowns.md` | 跨变更的未决事项 | 已登记与任务有关的事项时 | missing | 经批准的人工记录 |
| `intel/decisions.md` | 跨变更的决策 | 已登记与任务有关的决策时 | missing | 经批准的人工记录 |

## External Project Docs

| File | Priority | Notes |
| --- | --- | --- |
| `README.md` | 项目说明 | 记录构建与验证命令、数据库测试范围和凭据处理要求。 |

## Critical Unknowns

尚未登记。

## Consumption Rules

- 先读本索引，再按 `When To Read` 查阅当前任务需要的文件，不批量读取设置或项目事实。
- 前端任务读取已有的 `settings/frontend.md`；生成原型时另读已有的 `settings/prototype-style.md`。后端任务读取已有的 `settings/backend.md`。
- 代码图和生成的事实缓存只用于定位。修改前核实当前源码；报告验证结论前重新运行对应命令。
- 引用的源文件缺失时，相关缓存不再可靠。用 `.freshness.json`、当前源文件和已生成的正文实时判断过期或编辑冲突，不采用存档时的判断。
