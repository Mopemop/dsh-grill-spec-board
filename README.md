# dsh-grill-spec-board

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的规格驱动开发面板 + 配套 skill。

把 OpenSpec 风格的 change（proposal / specs / design / tech / tasks）变成可编辑、可校验、可确认的界面，并用 gate 把「需求 grill → 规格 → 技术设计 → TDD」锁成流程。

## 它解决什么问题

- **规格只是散文**：proposal/spec 写完没人检查，实现时全靠模型自由发挥；
- **技术决策黑箱**：数据库、接口、目录结构、选型到实现才临时决定；
- **改完没人确认**：结构被悄悄改动，评审时才发现；
- **测试后补**：先写实现再补测试，红绿循环不存在。

这个插件把上述四件事变成 **6 道可机器检查的 gate**。

## 功能

### 三种视图

- **需求列表**：产物完成度、任务进度、门禁状态、归档折叠、新建/删除项目；
- **需求详情**：Proposal / Capabilities（delta）/ Design / 技术设计 / 工程结构树 / 数据模型 ER / Tasks / 全局任务 / Grill 记录；
- **任务图**：跨 change 与全局任务，按功能分泳道，depends 连边，悬空依赖标红。

### 可编辑

Proposal 分段保存、capability 的 requirement/scenario 块编辑、design 四节编辑、任务勾选/增删、全局任务增删组。所有写入都带 hash 校验，冲突会拒绝并提示。

### 六道 gate

| Gate | 内容 |
|---|---|
| **G0** | 需求 grill 已确认（`grill/requirement.md`），写 proposal 前必须完成 |
| **G1** | 每条 requirement 在 `tech/coverage.md` 有落点 |
| **G2** | 任务有 `file:`/`test:`，契约与实体引用真实存在 |
| **G3** | 工程结构与数据模型已在面板确认（hash 一致） |
| **G4** | 技术 grill 已确认（`grill/tech.md`），写 tech/ 前必须完成 |
| **G5** | 每个任务组的第一条是测试任务（TDD） |

## 安装

### 1. 插件

```bash
git clone https://github.com/Mopemop/dsh-grill-spec-board.git
```

在 Harness 里用 `plugin_manager` 安装本地 bundle：

```json
{ "action": "install_bundle", "target": "<绝对路径>/dsh-grill-spec-board" }
```

装完刷新页面，左侧出现 **SpecBoard** 图标。

### 2. Skill（可选）

把 `skill/openspec-workflow` 复制到 agent 的 skills 目录：

```bash
cp -r skill/openspec-workflow ~/.agents/skills/
```

之后在对话里说「用 openspec-workflow 做一个 XX 需求」。

### 3. CLI（可选）

```bash
npm i -g @fission-ai/openspec
```

装了之后详情页的「校验」会调用官方 `openspec validate`；没装则降级为本地校验。

## 文件约定

```
openspec/
├── changes/<id>/
│   ├── proposal.md
│   ├── specs/<capability>/spec.md      # delta：ADDED/MODIFIED/REMOVED/RENAMED
│   ├── design.md                        # 可选：只写背景/目标
│   ├── tasks.md                         # 组标题 + 任务（file/test/contract/entity/depends）
│   ├── tech/
│   │   ├── research.md
│   │   ├── data-model.md                # 实体表 + Relations 表 → ER 图
│   │   ├── contracts/*.yaml
│   │   ├── structure.md                 # 目录树代码块 → 树图
│   │   ├── seams.md
│   │   ├── coverage.md                  # 领域分类 + 需求落点（G1）
│   │   └── approvals.json               # 确认记录（G3）
│   └── grill/
│       ├── requirement.md               # 需求 grill（G0）
│       ├── tech.md                      # 技术 grill（G4）
│       └── approvals.json
└── global-tasks.md                      # 跨功能任务（本插件约定）
```

任务写法：

```markdown
## 1. [expense-entry] 表单与校验（TDD）

- [ ] 1.1 写失败测试：非法金额被拒绝（test: test/expenses/validate.test.ts）
- [ ] 1.2 建 ExpenseForm（file: src/features/expenses/ExpenseForm.tsx; test: test/expenses/validate.test.ts）
- [ ] 1.3 金额校验（file: src/features/expenses/validate.ts; entity: expenses; depends: 1.2; test: test/expenses/validate.test.ts）
```

## 工作流

```text
需求 grill（G0）→ proposal → specs → design（可选）
→ 技术 grill（G4）→ tech/（确认结构/数据模型 G3）
→ tasks（测试先行 G5，覆盖 G1，引用 G2）
→ 实现：红 → 绿 → 重构
```

每一步写完都调用 `specboard_refresh` 让面板刷新，并在面板里确认后再继续。

## 架构

```
lib/core/registry.js       适配器注册表 + 项目发现
lib/core/project.js        通用操作（host 只依赖这里）
lib/adapters/openspec/     OpenSpec 的唯一实现（解析 + 文件系统）
client.js                  React UI
ui/style.css               由 scripts/build-css.mjs 生成，作用域限定 .sb-app
```

新增一种规范工具：在 `lib/adapters/<tool>/` 实现同一契约，然后在 `registry.js` 的 `ADAPTERS` 里加一项；Host 与 UI 不需要改。

## 开发

```bash
node scripts/selftest.mjs          # 16 项解析/门禁自测
node scripts/build-css.mjs <原型.html> ui/style.css   # 重新生成样式
```

## License

MIT
