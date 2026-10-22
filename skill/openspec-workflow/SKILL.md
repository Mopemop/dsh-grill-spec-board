---
name: openspec-workflow
description: OpenSpec 规格驱动开发，优先使用 openspec CLI，没有 CLI 时退回纯文件操作。把需求拆成 proposal / specs / tech / tasks，默认逐件生成并在 SpecBoard 面板检查。当用户说 openspec、opsx、规格驱动、需求拆分、tech grill、proposal、specs、tasks，或要新建/继续/修改一个 change 时使用。
---

# OpenSpec 工作流（CLI 优先 + 技术门禁）

把一条需求变成可审查、可实现、可校验的产物。**磁盘文件是唯一真相**，SpecBoard 是查看与编辑面。

默认**一次只生成一件**，每件生成后让用户在 SpecBoard 检查。用户明确要求"一次生成/全部生成/快速"时才连续生成。

## 铁律：下一步之前必须重读

1. 每次进入下一步，先用 read 工具重新读取相关文件（proposal / specs / tech / tasks）。
2. 以磁盘内容为准；与你记忆不同就采用磁盘版本，并说明"检测到人工修改"。
3. 写文件前确认已读取当前内容。

## 工具优先级

| 动作 | 有 CLI | 没有 CLI |
|---|---|---|
| 新建 change | `openspec new change <id>` | 手建目录与 proposal.md |
| 查状态 | `openspec status --change <id> --json` | 看文件是否存在 |
| 校验 | `openspec validate <id>` | 本地自检 + 本 skill 的门禁 |
| 取模板 | `openspec instructions <artifact> --change <id> --json` | `references/format.md` |

## 流程

```
0. 需求 grill（强制，确认后才写 proposal）→ grill/requirement.md
1. proposal.md
2. specs/<cap>/spec.md
2.5 design.md（可选：只写背景/目标/开放问题）
3. 技术 grill（强制，确认后才写 tech）→ grill/tech.md
4. tech/ 技术设计包（结构与数据模型需在 SpecBoard 确认）
5. tasks.md（TDD：每组第一条是测试任务）
6. 门禁 G0–G5
7. 实现（红 → 绿 → 重构）
8. 验收
```

### 0. 需求 grill（强制）

写 proposal 之前必须完成，并把问答记录写到 `openspec/changes/<id>/grill/requirement.md`，然后让用户在 SpecBoard 的「Grill 记录」面板点确认。

问什么（问到"能写出无歧义的 proposal"为止）：

1. 谁用、什么场景、现在怎么做？
2. 成功长什么样？验收口径是什么？
3. 明确不做什么（范围边界）？
4. 关键名词的定义（避免同名不同义）。
5. 失败/异常时用户看到什么？
6. 有什么硬约束（合规、性能、兼容）？

规则：一次最多 4 问、最多两轮；能读代码回答的不问；没答案的写进 `## Deferred` 并注明复评触发条件。**未确认不得写 proposal。**

模板见 `references/grill.md`。

### 1–2. proposal 与 specs

格式见 `references/format.md`。specs 完成后先别急着拆任务——下一步是技术决策。

### 2.5 design.md（可选，只写摘要）

design **不再承担"怎么做"**，只保留：

- `## Context`：现状与约束
- `## Goals / Non-Goals`
- `## Open Questions`（能答的并入 tech-grill）

不要写 `## Decisions`、表结构、接口、目录——这些属于 `tech/`。若 design 里出现 Decisions 而 tech 已存在，SpecBoard 会报「决策重复」的 docs 警告。

### 3. 技术 grill（强制，除非 tech-skip）

**不是固定 10 问，而是固定 6 个决策域**；只把未决的域变成问题。结果写到 `grill/tech.md`，并在 SpecBoard 的「Grill 记录」面板点确认——未确认不得写 `tech/`。

| 域 | 何时有问题 |
|---|---|
| 数据 | 新实体 / 字段 / 索引 / 删除语义 |
| 接口 | 对外或跨模块调用 |
| 结构 | 新增文件、目录或改依赖方向 |
| 选型 | 引入新依赖或替换实现 |
| 失败与运维 | 迁移、幂等、超时、回滚 |
| 验证 | 需要在某处测的可观察行为 |

对每个域先分类，并**给出证据**（文件行号、"沿用相邻模块"、"不涉及：纯文案"）：

```
Answered / Convention / Defaultable / Open / N/A / Deferred
```

规则：

- 只问 `Open`；按"影响 × 不确定性"排序；
- 每题先给**推荐答案**，人只需同意或改；
- **两轮、每轮 ≤4 题、总计 ≤8**；超过 8 个 Open → 建议拆分 change，而不是继续问；
- 没答案的写进 `research.md` 的 `## Deferred`，并写复评触发条件；
- 能读代码回答的不要问人；
- 结果写进 `tech/coverage.md` 的"领域"表。

**跳过条件**：纯文案 / 样式 / 无接口无数据的改动，写 `tech/coverage.md` 首行 `tech-skip: <原因>`，并说明为什么不需要。

### 4. tech/ 技术设计包

```
tech/
  research.md      选型：Chosen / Alternatives / Why / Revisit
  data-model.md    实体、字段（类型/约束/默认/索引）、关系、迁移
  contracts/       接口契约（yaml/json/md 均可，含 operation 名）
  structure.md     目录树 + 模块边界 + 依赖方向
  seams.md         测试接缝：Seam / 位置 / 覆盖的需求
  coverage.md      领域分类表 + 需求落点表
```

模板见 `references/tech/templates.md`。**每件都要在 SpecBoard 里确认后再进入下一步。**

`structure.md` 的目录树必须放在 ```text 代码块里（SpecBoard 会解析成树图）；`data-model.md` 的每个实体用 `## 实体名` + 字段表，关系写在 `## Relations` 表里（SpecBoard 会画 ER 图）。

**G3 人工确认**：`structure.md` 与 `data-model.md` 写完后，必须让用户在 SpecBoard 的「工程结构」「数据模型」面板点「确认结构 / 确认数据模型」。确认记录的是文件 hash；之后任何修改都会让确认失效，需要重新确认。**未确认不得生成 tasks 或开始实现。**

### 5. tasks.md

在原有格式上增加引用，写完就能被门禁检查：

```markdown
## 1. [expense-entry] 表单与校验（TDD）

- [ ] 1.1 写失败测试：非法金额被拒绝（test: test/expenses/validate.test.ts）
- [ ] 1.2 建 ExpenseForm（file: src/features/expenses/ExpenseForm.tsx; test: test/expenses/validate.test.ts）
- [ ] 1.3 金额校验（file: src/features/expenses/validate.ts; entity: expenses; depends: 1.2; test: test/expenses/validate.test.ts）
```

- **每个任务组的第一条必须是测试任务**（只带 `test:`，不带 `file:` 也可以）；
- 后续每条实现任务都带 `file:` 与同一个 `test:`；
- 涉及接口加 `contract:`，涉及数据加 `entity:`；
- 多个标注用 `;` 分隔，`depends:` 保留。

### 6. 门禁

**G0**：需求 grill 已确认（`grill/requirement.md`）。

**G1**：每条 requirement 在 `coverage.md` 的"需求落点"里有一行，且 `contract` 或 `entity` 非空，或备注写 `no-interface`。

**G2**：每个 task 有 `file:`（测试任务有 `test:` 也算）；`contract:` 指向的文件存在且包含该 operation；`entity:` 在 `data-model.md` 里出现。

**G3**：`structure.md` 与 `data-model.md` 已经在 SpecBoard 确认，且确认后未被修改（hash 一致）。

**G4**：技术 grill 已确认（`grill/tech.md`）。

**G5**：每个任务组的第一条是测试任务（带 `test:`）。

门禁不过就停在原地修，**不要进入实现**。SpecBoard 顶部会显示"实现就绪"或"门禁未过"。

### 7. 实现（TDD：红 → 绿 → 重构）

每组按这个循环推进，**不允许先写实现再补测试**：

1. **红**：先完成该组的第一条测试任务，运行测试并确认**失败**（贴出失败输出/断言）；
2. **绿**：完成实现任务，只写让当前测试通过的最小代码，再跑一次确认**通过**；
3. **重构**：测试保持通过的前提下整理代码，不做行为变更；
4. 每完成一条任务就勾选，并在回复里给出"运行了什么、结果如何"。

约束：

- 只允许写 tasks 里 `file:` / `test:` 列出的路径；要新建文件先回写 tasks；
- 测试文件与实现文件分离，测试不得依赖实现内部细节；
- 实现中发现契约要改 → 回到 `tech/contracts` 改，重跑门禁，而不是在代码里改字段名；
- 任何"先跳过测试"的请求都要明确记录为偏离，并要求用户确认。

## 模式

| 模式 | 行为 |
|---|---|
| 逐步（默认） | 每件产物写完后调 `specboard_refresh` 并等确认 |
| 一次性 | 用户明确要求时；tech-grill 由 agent 自答并写入 `research.md#Assumptions`，最后统一门禁 |
| tech-skip | 纯文案/样式改动，coverage.md 写 `tech-skip: 原因` |

## 每步刷新

```
specboard_refresh { change: "<id>", artifact: "proposal" | "specs" | "design" | "tech" | "tasks" }
```

然后说一句「已生成 <artifact>，请到 SpecBoard 检查/修改，确认后继续」。

## 不做什么

- 不手工把 delta 合并进 `openspec/specs/`（归档用 `openspec archive`）
- 不修改主 spec
- 不在 specs 里写实现细节（类名、框架、库选择属于 tech 或 design）
