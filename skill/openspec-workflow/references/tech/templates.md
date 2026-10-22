# tech/ 模板

六个文件，放在 `openspec/changes/<id>/tech/`。每件都在 SpecBoard 确认后再写下一件。

---

## coverage.md（门禁入口）

首行可写 `tech-skip: <原因>` 跳过整套门禁（仅限纯文案/样式改动）。

```markdown
# Tech Coverage

## 领域

| 域 | 状态 | 证据/决定 |
|---|---|---|
| 数据 | Answered | data-model.md#expenses |
| 接口 | Answered | contracts/api.yaml#POST /expenses |
| 结构 | Convention | 沿用 src/features/expenses/ |
| 选型 | Defaultable | 复用现有依赖，不新增库 |
| 失败 | Deferred | 大批量导入限流，触发条件：单次 >10k 行 |
| 验证 | Answered | seams.md#api-expenses |

## 需求落点

| Requirement | Contract | Entity | Notes |
|---|---|---|---|
| 记录一笔支出 | contracts/api.yaml#POST /expenses | expenses | |
| 本地持久化 |  | expenses | no-interface：直接写 localStorage |
```

状态取值：`Answered / Convention / Defaultable / Open / N/A / Deferred`。
G1 只检查第二张表：每条 requirement 必须有一行，且 contract/entity 非空或 notes 写 `no-interface`。

---

## research.md（选型）

```markdown
# Research

## Decision: 金额存储

- Chosen: 整数分（amount_cents）
- Alternatives: 浮点 / 字符串
- Why: 避免浮点误差，聚合简单
- Revisit: 需要多币种时再引入 currency 字段

## Deferred

- 大批量导入的限流方案；触发条件：单次导入 > 10k 行
```

---

## data-model.md（数据）

```markdown
# Data Model

## expenses

| 字段 | 类型 | 约束 | 默认 | 索引 |
|---|---|---|---|---|
| id | uuid | 主键 | 自动 | PK |
| amount_cents | integer | > 0 | — | |
| category | text | 枚举：餐饮/交通/居住/其他 | 其他 | idx_category |
| created_at | timestamptz | 非空 | now() | idx_created_at |

关系：无（单表）。
迁移：新增表，无历史数据迁移。
删除：硬删；不做软删。

## Relations

| From | To | Type | On |
|---|---|---|---|
| expenses | categories | n..1 | category_id |
```

`## Relations` 表会被 SpecBoard 画成 ER 图的连线；没有关系就删掉这一节。每个实体用 `## 实体名` 开头，紧跟字段表。

确认：写完后在 SpecBoard 的「数据模型」面板点**确认数据模型**；之后任何修改都会让确认失效（G3）。

G2 只做包含匹配：任务的 `entity: expenses` 必须能在本文件里找到该词。所以实体名要一致。

---

## contracts/api.yaml（接口）

任何格式都行，但必须包含任务里引用的 **operation 文本**（如 `POST /expenses`）。

```yaml
openapi: 3.0.0
info: { title: Expenses, version: "1" }
paths:
  /expenses:
    post:
      operationId: POST /expenses
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [amount_cents, category]
              properties:
                amount_cents: { type: integer, minimum: 1 }
                category: { type: string }
                note: { type: string, maxLength: 200 }
      responses:
        "201": { description: created }
        "400": { description: invalid amount }
```

CLI 风格的工具也可以只用 markdown：

```markdown
## POST /expenses

输入：amount_cents（正整数）、category（枚举）、note（≤200）
输出：201 + expense 对象；400 金额非法
```

---

## structure.md（结构）

```markdown
# Structure

```text
src/
  features/expenses/
    ExpenseForm.tsx
    api.ts
    validate.ts
  shared/
    money.ts
```

依赖方向：features → shared；shared 不反向依赖 features。
本 change 不新增顶层目录；不改动 build 配置。
```

目录树必须放在 ```text 代码块里（用 `├──` / `└──` / `│`），SpecBoard 会把它渲染成可折叠的树。写完后在「工程结构」面板点**确认结构**；之后修改会让确认失效（G3）。

---

## seams.md（验证接缝）

```markdown
# Seams

| Seam | 位置 | 覆盖的需求 |
|---|---|---|
| api-expenses | test/api/expenses.test.ts | 记录一笔支出 |
| storage-local | test/storage/local.test.ts | 本地持久化 |
```

每个 seam 写清"在哪个文件测、覆盖哪条需求"；实现时只在这些接缝上补测试。
