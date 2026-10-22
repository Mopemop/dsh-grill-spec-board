# 产物格式与完整示例

四件产物都写在 `openspec/changes/<change-id>/` 下。以下模板可直接复制，尖括号是占位符。

---

## 1. proposal.md

```markdown
# Proposal

## Why

<1–2 句：要解决什么问题，为什么现在做>

## What Changes

- <具体改动 1>
- <具体改动 2，破坏性变更标 **BREAKING**>

## Capabilities

### New Capabilities

- `<capability-path>`: <这个能力覆盖什么行为>

### Modified Capabilities

- `<existing-capability-path>`: <哪条需求变了>

## Impact

- <影响的代码、接口、数据、依赖>
```

规则：

- 每个列出的 capability 都要有对应的 `specs/<path>/spec.md`
- 纯重构 / 文档类改动没有 spec 变化时，写 `skip_specs: true` 到 `.openspec.yaml`
- 不要为了让校验通过而编造需求

---

## 2. specs/<capability>/spec.md（delta）

```markdown
# Spec Delta

## Purpose

<仅新增 capability 需要：一两句话，≥50 字符>

## ADDED Requirements

### Requirement: <名称>

<一句话描述，≤500 字符，用 SHALL / MUST>

#### Scenario: <场景名>

- **WHEN** <条件>
- **THEN** <预期结果>

## MODIFIED Requirements

### Requirement: <已存在的名称>

<替换后的完整描述>

#### Scenario: <场景名>

- **WHEN** …
- **THEN** …

## REMOVED Requirements

### Requirement: <名称>

**Reason**: <为什么删>
**Migration**: <旧用户怎么迁移>

## RENAMED Requirements

### Requirement: <新名称>

- FROM: `旧名称`
- TO: `新名称`
```

硬规则：

| 规则 | 说明 |
|---|---|
| 场景标题 | **必须 4 个 `#`**（`#### Scenario:`），3 个会静默失效 |
| 场景数量 | 每条 requirement 至少 1 个 |
| 描述长度 | ≤500 字符（超了 `--strict` 会报错） |
| Purpose | 只给**新增** capability 写；修改现有 capability 不要加 |
| MODIFIED | 必须贴完整的替换内容，不能只写改动片段 |
| REMOVED | 必须有 `**Reason**` 与 `**Migration**` |
| RENAMED | 用 `- FROM:` / `- TO:`，不要重写描述 |
| 内容边界 | 不写类名、框架、库选择——那是 `tech/` 的事 |

---

## 3. design.md（可选，只写摘要）

```markdown
# Design

## Context

<只写理解方案所需的现状与约束；动机引用 proposal，不要复述>

## Goals / Non-Goals

**Goals:**

- <这个方案要达成的>

**Non-Goals:**

- <明确排除的>

## Open Questions

<能当场回答的并入 tech-grill；定不了的写"无">

> 技术决策见 `tech/research.md`；数据模型见 `tech/data-model.md`；接口见 `tech/contracts/`。
```

**不要写** `## Decisions`、表结构、接口定义、目录结构——这些分别在 `tech/research.md`、`data-model.md`、`contracts/`、`structure.md`。两处都写会被 SpecBoard 标为「决策重复」。

只在以下情况写 design：跨模块改动、新外部依赖、数据模型变更、安全/性能/迁移有复杂度。

---

## 4. tasks.md（TDD）

```markdown
# Tasks

## 1. [<capability-path>] <组标题>（TDD）

- [ ] 1.1 写失败测试：<行为>（test: test/<area>/<name>.test.ts）
- [ ] 1.2 <实现任务>（file: src/<area>/<file>.ts; test: test/<area>/<name>.test.ts）
- [ ] 1.3 <实现任务>（file: src/<area>/<name>.ts; entity: <entity>; depends: 1.2; test: test/<area>/<name>.test.ts）

## 2. [<capability-path>] <组标题>（TDD）

- [ ] 2.1 写失败测试：<行为>（test: test/<area>/<other>.test.ts）
- [ ] 2.2 <实现任务>（file: src/<area>/<other>.ts; test: test/<area>/<other>.test.ts）
```

规则：

- 组标题格式 `## N. [capability] 标题`；没有 `[capability]` 时 SpecBoard 会标黄
- 任务 `- [ ] N.M 描述`，编号是组号 + 序号
- **每个组的第一条必须是测试任务**（`test:`），否则 G5 不过
- 实现任务必须有 `file:`，并带上同一个 `test:`
- 依赖写在行尾 `（depends: 1.2; test: ...）`，多个标注用 `;` 分隔
- 删除任务**保留编号空洞**，不重排

---

## 5. global-tasks.md（跨功能任务）

```markdown
# Tasks

## 1. [global] 工程基础

- [ ] 1.1 统一目录结构（src/app、src/features、src/shared）
- [ ] 1.2 抽取公共工具：日期、请求、错误提示
- [ ] 1.3 收敛配置项到 config/index.ts
```

用于不属于任何单个 change 的任务：目录结构、公共工具、统一配置。

---

## 完整示例：一个 change

`openspec/changes/add-expense-entry/`

**proposal.md**

```markdown
# Proposal

## Why

用户需要一个能在一分钟内记下一笔支出的入口，现在只能靠外部记账软件。

## What Changes

- 新增「记一笔」表单：金额、分类、备注
- 保存到本地账本，列表立即可见

## Capabilities

### New Capabilities

- `expense-entry`: 创建一笔支出记录并即时反映到列表

### Modified Capabilities

## Impact

- 前端：表单组件、列表状态
- 存储：本地账本读写
```

**specs/expense-entry/spec.md**

```markdown
# Spec Delta

## Purpose

让用户用最少的输入完成一笔支出的记录，并立刻在列表里看到结果。

## ADDED Requirements

### Requirement: 记录一笔支出

用户 SHALL 能输入金额、选择分类并保存，金额必须大于 0。

#### Scenario: 正常保存

- **WHEN** 用户输入 25.5、选择「餐饮」并保存
- **THEN** 列表顶部出现这条记录，表单清空

#### Scenario: 非法金额

- **WHEN** 用户输入 0 或负数
- **THEN** 保存按钮禁用并提示「金额需大于 0」
```

**tasks.md**

```markdown
# Tasks

## 1. [expense-entry] 表单与校验

- [ ] 1.1 建立 ExpenseForm 组件并渲染三个字段
- [ ] 1.2 金额校验：> 0、两位小数（depends: 1.1）

## 2. [expense-entry] 保存与列表

- [ ] 2.1 写入 ledger.entries 并返回新记录（depends: 1.2）
- [ ] 2.2 列表顶部插入新记录并清空表单（depends: 2.1）
```
