# Grill 记录模板

两份记录都放在 `openspec/changes/<id>/grill/`，写完后在 SpecBoard 的「Grill 记录」面板确认。
确认记录文件 hash，改动后自动失效（G0 / G4）。

---

## requirement.md（写 proposal 之前）

```markdown
# 需求 Grill

## Q1 谁用、什么场景、现在怎么做？

- 回答：
- 影响：

## Q2 成功长什么样？验收口径？

- 回答：
- 影响：

## Q3 明确不做什么？

- 回答：

## Q4 关键名词的定义

- 回答：

## Q5 失败/异常时用户看到什么？

- 回答：

## Q6 硬约束（合规 / 性能 / 兼容）

- 回答：

## Deferred

- <未决项> ；复评触发条件：<什么时候必须决定>

## 结论

- <3–6 条已确定的决定>
```

规则：一次最多 4 问、最多两轮；能读代码回答的不问；每题先给推荐答案。

---

## tech.md（写 tech/ 之前）

```markdown
# 技术 Grill

## 6 个决策域

| 域 | 状态 | 证据/决定 |
|---|---|---|
| 数据 | Answered | data-model.md#expenses |
| 接口 | Answered | contracts/api.yaml#POST /expenses |
| 结构 | Convention | 沿用 src/features/ |
| 选型 | Defaultable | 复用现有依赖 |
| 失败 | Answered | 金额非法 → 400 |
| 验证 | Answered | test/api/expenses.test.ts |

## 关键决定

- <决定 + 理由 + 替代方案>

## Deferred

- <未决项> ；复评触发条件：<...>
```

状态取值：`Answered / Convention / Defaultable / Open / N/A / Deferred`。
只有 `Open` 的域需要提问；超过 8 个 Open 建议拆分 change。
