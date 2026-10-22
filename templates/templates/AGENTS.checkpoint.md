# SpecBoard 检查点约定（模板）

把这段加到使用 SpecBoard 的项目根目录 `AGENTS.md` 里。

## 每生成一件产物就通知检查

写完**任意一件**产物后，立即调用 `specboard_refresh`，带上 change 与 artifact：

```
specboard_refresh { change: "<change-id>", artifact: "proposal" | "specs" | "tech" | "tasks" }
```

然后对用户说一句「已生成 <artifact>，请到 SpecBoard 检查/修改后再继续」，等确认再写下一件。

顺序：需求 grill → `proposal.md` → `specs/<capability>/spec.md` → 技术 grill → `tech/` → `tasks.md`。

## 强制步骤

- **需求 grill**：写 proposal 之前完成 `grill/requirement.md`，并在 SpecBoard 确认（G0）；
- **技术 grill**：写 tech/ 之前完成 `grill/tech.md`，并在 SpecBoard 确认（G4）；
- **TDD**：tasks 每组第一条是测试任务（`test:`），实现时先跑红、再写实现、再跑绿（G5）。

## 技术门禁

- tech 阶段完成后先看 SpecBoard 顶部是否显示「实现就绪」；
- **工程结构与数据模型必须在 SpecBoard 里点「确认结构 / 确认数据模型」**，未确认（或确认后又改过）G3 不过；
- 门禁没过（G0/G1/G2/G3/G4/G5）不要开始实现，先补对应文件或标注。

## 不要一次性生成四件产物

用户需要在每一步之间用 SpecBoard 修改内容。除非用户明确要求"一步到位"。
