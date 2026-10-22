/**
 * 本地自测：不依赖 DSH 运行时，直接验证解析/写回逻辑。
 * 运行：node scripts/selftest.mjs
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  parseTasks,
  renderTasks,
  toggleTaskLine,
  appendTask,
  removeTaskLine,
  appendGroup,
  replaceSection,
  parseDelta,
  parseProposal,
  deriveArtifacts,
  progressOf,
  lintChange,
  lintTech,
  parseAnnotation,
  parseStructureTree,
} from '../lib/adapters/openspec/spec.js'
import { discoverProjects, loadProject } from '../lib/core/project.js'

const workspace = path.resolve(import.meta.dirname, '..', '..')

let passed = 0
function check(name, fn) {
  return Promise.resolve(fn()).then(() => {
    passed += 1
    console.log('ok  ' + name)
  })
}

const sample = `# Tasks

## 1. [dark-mode] 深色模式

- [ ] 1.1 定义主题 token（depends: 0.1）
- [x] 1.2 实现切换器
- [ ] 1.3 持久化

## 2. 收尾

- [ ] 2.1 文档
`

await check('parseTasks: 组与任务的 capability/依赖/勾选', () => {
  const model = parseTasks(sample)
  assert.equal(model.groups.length, 2)
  assert.equal(model.groups[0].capability, 'dark-mode')
  assert.equal(model.groups[1].capability, null)
  assert.equal(model.tasks.length, 4)
  assert.deepEqual(model.tasks[0].depends, ['0.1'])
  assert.equal(model.tasks[1].done, true)
  assert.equal(model.tasks[0].text, '定义主题 token')
})

await check('renderTasks: 重新解析后结构一致', () => {
  const model = parseTasks(sample)
  const again = parseTasks(renderTasks(model))
  assert.equal(again.tasks.length, 4)
  assert.deepEqual(again.tasks.map((t) => t.id), ['1.1', '1.2', '1.3', '2.1'])
  assert.deepEqual(again.tasks[0].depends, ['0.1'])
  assert.equal(again.tasks[1].done, true)
})

await check('toggleTaskLine: 只改目标行', () => {
  const next = toggleTaskLine(sample, 5, true)
  assert.ok(next.includes('- [x] 1.1 定义主题 token（depends: 0.1）'))
  assert.equal(next.split('\n').length, sample.split('\n').length)
  assert.ok(next.includes('- [ ] 1.3 持久化'))
})

await check('appendTask: 编号取组内最大 +1', () => {
  const result = appendTask(sample, 1, '补一个任务')
  assert.equal(result.id, '1.4')
  assert.ok(result.md.includes('- [ ] 1.4 补一个任务'))
  // 新任务必须在 1.3 之后、## 2 之前
  assert.ok(result.md.indexOf('1.4 补一个任务') < result.md.indexOf('## 2.'))
})

await check('removeTaskLine: 留下编号空洞', () => {
  const next = removeTaskLine(sample, 6)
  assert.ok(!next.includes('1.2 实现切换器'))
  assert.ok(next.includes('1.3 持久化'))
})

await check('appendGroup: 组号 +1 且写 capability', () => {
  const result = appendGroup(sample, 'settings', '配置项')
  assert.equal(result.num, 3)
  assert.ok(result.md.includes('## 3. [settings] 配置项'))
})

await check('replaceSection: 只替换目标 section', () => {
  const md = `# P\n\n## Why\n\n旧内容\n\n## Impact\n\n保持不动\n`
  const next = replaceSection(md, 'Why', '新内容')
  assert.ok(next.includes('新内容'))
  assert.ok(!next.includes('旧内容'))
  assert.ok(next.includes('## Impact'))
  assert.ok(next.includes('保持不动'))
})

await check('parseProposal: 解析 New/Modified Capabilities', () => {
  const md = `# Proposal\n\n## Why\n\n因为\n\n## Capabilities\n\n### New Capabilities\n\n- \`user-auth\`: 登录\n\n### Modified Capabilities\n\n- \`billing\`: 改税率\n\n## Impact\n\n无`
  const p = parseProposal(md)
  assert.equal(p.why, '因为')
  assert.deepEqual(p.newCapabilities, [{ path: 'user-auth', description: '登录' }])
  assert.deepEqual(p.modifiedCapabilities, [{ path: 'billing', description: '改税率' }])
})

await check('parseDelta: requirement + scenario 数量正确', () => {
  const md = `# Spec Delta\n\n## Purpose\n\n让用户导出数据，格式可移植。\n\n## ADDED Requirements\n\n### Requirement: 导出\n系统 SHALL 支持 CSV。\n\n#### Scenario: 成功\n- **WHEN** 点击导出\n- **THEN** 下载 CSV\n`
  const d = parseDelta(md)
  assert.equal(d.requirements.length, 1)
  assert.equal(d.requirements[0].scenarios.length, 1)
  assert.equal(d.requirements[0].scenarios[0].then, '下载 CSV')
})

await check('deriveArtifacts / progressOf', () => {
  const arts = deriveArtifacts({ proposal: true, specs: true, design: false, tasks: false })
  assert.deepEqual(arts.map((a) => a.state), ['done', 'done', 'ready', 'ready', 'ready'])
  assert.equal(progressOf([]).ratio, null)
  assert.equal(progressOf([{ done: true }, { done: false }]).ratio, 0.5)
})

await check('parseAnnotation: depends/file/contract/entity', () => {
  const meta = parseAnnotation('depends: 1.2, 1.3; file: src/a.ts; contract: contracts/api.yaml#POST /x; entity: expenses')
  assert.deepEqual(meta.depends, ['1.2', '1.3'])
  assert.deepEqual(meta.files, ['src/a.ts'])
  assert.deepEqual(meta.contracts, ['contracts/api.yaml#POST /x'])
  assert.deepEqual(meta.entities, ['expenses'])
})

await check('lintTech: G1 覆盖 与 G2 引用', () => {
  const change = {
    capabilities: [{ path: 'expenses', requirements: [{ name: 'r1' }, { name: 'r2' }] }],
    tasks: [
      { id: '1.1', files: [], contracts: ['contracts/api.yaml#POST /x'], entities: ['expenses'] },
      { id: '1.2', files: ['src/a.ts'], contracts: ['contracts/missing.yaml#GET /y'], entities: [] },
    ],
    tech: {
      coverage: { requirements: [{ requirement: 'r1', contract: 'contracts/api.yaml#POST /x', entity: '', notes: '' }] },
      contracts: [{ file: 'contracts/api.yaml', text: 'POST /x' }],
      dataModel: '| expenses |',
    },
  }
  const issues = lintTech(change)
  assert.ok(issues.some((i) => i.gate === 'G1' && i.message.includes('r2')))
  assert.ok(issues.some((i) => i.gate === 'G2' && i.message.includes('缺少 file:')))
  assert.ok(issues.some((i) => i.gate === 'G2' && i.message.includes('契约不存在')))
  assert.ok(!issues.some((i) => i.message.includes('r1')))
})

await check('lintChange: 缺 scenario 与悬空依赖会报错', () => {
  const model = parseTasks(sample)
  const issues = lintChange({
    files: { proposal: true },
    capabilities: [{
      path: 'dark-mode',
      isNew: true,
      hash: 'abc',
      purpose: 'x',
      requirements: [{ name: 'r', scenarios: [] }],
    }],
    taskGroups: model.groups,
    tasks: model.tasks,
  })
  assert.ok(issues.some((i) => i.level === 'error' && i.message.includes('没有 scenario')))
  assert.ok(issues.some((i) => i.level === 'error' && i.message.includes('0.1')))
  assert.ok(issues.some((i) => i.level === 'warn' && i.message.includes('没有 [capability]')))
})

await check('discoverProjects: 能在工作区找到 openspec 项目', async () => {
  const projects = await discoverProjects([workspace], 3)
  assert.ok(projects.length >= 1, '应至少发现一个 openspec 目录')
  const target = projects.find((p) => p.root === workspace) ?? projects[0]
  const project = await loadProject(target.root)
  assert.ok(Array.isArray(project.changes))
  assert.equal(typeof project.globalTasks.exists, 'boolean')
})

await check('主 spec（## Requirements 结构）可被 parseDelta 解析', () => {
  const md = `# 能力规格

## Purpose

描述这个能力。

## Requirements

### Requirement: 会话过期

会话 SHALL 在 2 小时后过期。

#### Scenario: 过期

- **WHEN** 超过 2 小时
- **THEN** 需要重新登录
`
  const d = parseDelta(md)
  assert.ok(d.requirements.length > 0, '主 spec 应有 requirement')
  assert.equal(d.requirements[0].scenarios.length, 1)
})

await check('parseStructureTree: 盒线与空格两种缩进', () => {
  const box = '# S\n\n```text\nsrc/\n├── a/\n│   └── x.ts\n└── b.ts\n```\n'
  const spaces = '# S\n\n```text\nsrc/\n  a/\n    x.ts\n  b.ts\n```\n'
  for (const md of [box, spaces]) {
    const tree = parseStructureTree(md)
    assert.equal(tree.children.length, 1, '根下只有一个 src/')
    assert.equal(tree.children[0].name, 'src/')
    assert.deepEqual(tree.children[0].children.map((c) => c.name), ['a/', 'b.ts'])
    assert.equal(tree.children[0].children[0].children[0].name, 'x.ts')
  }
})

console.log(`\n${passed} checks passed`)
