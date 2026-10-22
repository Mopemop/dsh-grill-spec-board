/**
 * OpenSpec 文本层：把 `openspec/` 下的 markdown 解析成块模型，再按「只改被编辑的 section」
 * 的规则写回。所有函数都是纯函数，不碰文件系统，便于单独测试。
 *
 * 目录事实（v1.14.x）：
 *   openspec/changes/<id>/proposal.md
 *   openspec/changes/<id>/design.md          （可选）
 *   openspec/changes/<id>/specs/<cap>/spec.md（delta）
 *   openspec/changes/<id>/tasks.md
 *   openspec/specs/<cap>/spec.md             （主 spec，只读对照）
 */

const ANNOTATION_RE = /[（(]([^（）()]*)[）)]\s*$/
const TASK_RE = /^\s*-\s*\[([ xX])\]\s*([0-9]+(?:\.[0-9]+)+)\s+(.*)$/
const GROUP_RE = /^##\s+([0-9]+)\.\s*(?:\[([^\]]+)\]\s*)?(.*)$/

export const ARTIFACT_ORDER = ['proposal', 'specs', 'design', 'tech', 'tasks']

/** 只用于展示的产物定义；design 允许跳过，tasks 的实际依赖只看 specs。 */
export const ARTIFACT_DEFS = {
  proposal: { file: 'proposal.md', label: 'Proposal', optional: false },
  specs: { file: 'specs', label: 'Specs', optional: false },
  design: { file: 'design.md', label: 'Design', optional: true },
  tech: { file: 'tech', label: 'Tech', optional: false },
  tasks: { file: 'tasks.md', label: 'Tasks', optional: false },
}

export function slugify(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/* ------------------------------------------------------------------ sections */

/**
 * 把 markdown 切成「标题 + 正文」的 section 列表。
 * 只认 `##` 及更深的标题，`#` 视为文档标题。
 * 正文延伸到下一个「同级或更高级」标题为止，因此父节的正文包含其子节。
 */
export function sections(md) {
  const lines = String(md ?? '').split(/\r?\n/)
  const heads = []
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(#{2,6})\s+(.*)$/.exec(lines[i])
    if (m) heads.push({ level: m[1].length, title: m[2].trim(), line: i })
  }
  return heads.map((head, index) => {
    let end = lines.length
    for (let j = index + 1; j < heads.length; j += 1) {
      if (heads[j].level <= head.level) {
        end = heads[j].line
        break
      }
    }
    return {
      level: head.level,
      title: head.title,
      headingLine: head.line,
      body: lines.slice(head.line + 1, end).join('\n').replace(/^\n+|\n+$/g, ''),
    }
  })
}

/** 找到某个二级标题的正文（默认只匹配 `##`）。 */
export function sectionBody(md, title) {
  const found = sections(md).find((s) => s.level === 2 && s.title.toLowerCase() === title.toLowerCase())
  return found ? found.body : ''
}

/**
 * 用新正文替换某个标题的 section 正文，其余字节原样保留。
 * 找不到标题时追加到文末。
 */
export function replaceSection(md, title, body) {
  const text = String(md ?? '')
  const lines = text.split(/\r?\n/)
  const norm = title.trim().toLowerCase()
  let start = -1
  let level = 2
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(#{2,6})\s+(.*)$/.exec(lines[i])
    if (m && m[2].trim().toLowerCase() === norm) {
      start = i
      level = m[1].length
      break
    }
  }
  if (start < 0) {
    const tail = text.endsWith('\n') ? '' : '\n'
    return `${text}${tail}\n## ${title}\n\n${body.trim()}\n`
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = /^(#{1,6})\s+/.exec(lines[i])
    if (m && m[1].length <= level) {
      end = i
      break
    }
  }
  const head = lines.slice(0, start + 1)
  const rest = lines.slice(end)
  const next = [...head, '', ...body.trim().split('\n'), ...(rest.length ? [''] : []), ...rest]
  return next.join('\n').replace(/\n{3,}/g, '\n\n')
}

/* ------------------------------------------------------------------ proposal */

export function parseProposal(md) {
  const text = String(md ?? '')
  const capabilities = parseCapabilitiesList(sectionBody(text, 'Capabilities'))
  return {
    title: firstHeading(text) || 'Proposal',
    why: sectionBody(text, 'Why'),
    changes: sectionBody(text, 'What Changes'),
    impact: sectionBody(text, 'Impact'),
    newCapabilities: capabilities.new,
    modifiedCapabilities: capabilities.modified,
  }
}

function parseCapabilitiesList(body) {
  const out = { new: [], modified: [] }
  let bucket = null
  for (const raw of String(body ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (/^###\s+new capabilities/i.test(line)) {
      bucket = out.new
      continue
    }
    if (/^###\s+modified capabilities/i.test(line)) {
      bucket = out.modified
      continue
    }
    if (!bucket) continue
    const m = /^-\s*`?([^`:]+)`?\s*[:：]\s*(.*)$/.exec(line)
    if (m) bucket.push({ path: m[1].trim(), description: m[2].trim() })
  }
  return out
}

export function renderCapabilities(caps) {
  const list = (items) => (items.length ? items.map((c) => `- \`${c.path}\`: ${c.description}`).join('\n') : '')
  return ['### New Capabilities', list(caps.new), '', '### Modified Capabilities', list(caps.modified)].join('\n')
}

/* ---------------------------------------------------------------- delta spec */

const DELTA_OPS = [
  ['ADDED', /^##\s+ADDED Requirements/i],
  ['MODIFIED', /^##\s+MODIFIED Requirements/i],
  ['REMOVED', /^##\s+REMOVED Requirements/i],
  ['RENAMED', /^##\s+RENAMED Requirements/i],
]

/** 解析 delta spec：Purpose + 四类操作 + Requirement/Scenario。 */
export function parseDelta(md) {
  const text = String(md ?? '')
  const lines = text.split(/\r?\n/)
  const result = { purpose: sectionBody(text, 'Purpose'), ops: [], requirements: [] }
  let op = null
  let req = null
  let scenario = null

  const flushScenario = () => {
    if (scenario && req) req.scenarios.push(scenario)
    scenario = null
  }
  const flushReq = () => {
    flushScenario()
    if (req) result.requirements.push(req)
    req = null
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const opHit = DELTA_OPS.find(([, re]) => re.test(line))
    if (opHit) {
      flushReq()
      op = opHit[0]
      if (!result.ops.includes(op)) result.ops.push(op)
      continue
    }
    const rm = /^###\s+Requirement:\s*(.*)$/.exec(line)
    if (rm) {
      flushReq()
      req = { op: op ?? 'ADDED', name: rm[1].trim(), description: '', scenarios: [], reason: '', migration: '', from: '', to: '', startLine: i + 1 }
      continue
    }
    const sm = /^####\s+Scenario:\s*(.*)$/.exec(line)
    if (sm) {
      flushScenario()
      scenario = { name: sm[1].trim(), when: '', then: '', extra: [], startLine: i + 1 }
      continue
    }
    if (scenario) {
      const when = /^\s*-\s*\*\*WHEN\*\*\s*(.*)$/i.exec(line)
      const then = /^\s*-\s*\*\*THEN\*\*\s*(.*)$/i.exec(line)
      if (when) scenario.when = when[1].trim()
      else if (then) scenario.then = then[1].trim()
      else if (line.trim()) scenario.extra.push(line)
      continue
    }
    if (req) {
      const reason = /^\s*\*\*Reason\*\*\s*[:：]\s*(.*)$/i.exec(line)
      const migration = /^\s*\*\*Migration\*\*\s*[:：]\s*(.*)$/i.exec(line)
      const from = /^\s*-\s*\*?\*?FROM\*?\*?\s*[:：]\s*`?([^`]*?)`?\s*$/i.exec(line)
      const to = /^\s*-\s*\*?\*?TO\*?\*?\s*[:：]\s*`?([^`]*?)`?\s*$/i.exec(line)
      if (reason) req.reason = reason[1].trim()
      else if (migration) req.migration = migration[1].trim()
      else if (from) req.from = from[1].trim()
      else if (to) req.to = to[1].trim()
      else if (!req.description && line.trim()) req.description = line.trim()
      else if (req.description && line.trim()) req.description += '\n' + line
    }
  }
  flushReq()
  return result
}

export function renderDelta(delta) {
  const chunks = ['# Spec Delta', '']
  if (delta.purpose) chunks.push('## Purpose', '', delta.purpose.trim(), '')
  for (const op of ['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED']) {
    const reqs = delta.requirements.filter((r) => r.op === op)
    if (!reqs.length) continue
    chunks.push(`## ${op} Requirements`, '')
    for (const r of reqs) {
      chunks.push(`### Requirement: ${r.name}`)
      if (op === 'REMOVED') {
        chunks.push(`**Reason**: ${String(r.reason ?? '').trim()}`, `**Migration**: ${String(r.migration ?? '').trim()}`, '')
        continue
      }
      if (op === 'RENAMED') {
        chunks.push(`- FROM: \`${String(r.from ?? '').trim()}\``, `- TO: \`${String(r.to ?? '').trim()}\``, '')
        continue
      }
      chunks.push(r.description.trim(), '')
      for (const s of r.scenarios) {
        chunks.push(`#### Scenario: ${s.name}`, `- **WHEN** ${s.when}`, `- **THEN** ${s.then}`, '')
        for (const extra of s.extra ?? []) chunks.push(extra)
      }
    }
  }
  return chunks.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/* --------------------------------------------------------------------- tasks */

/**
 * 解析 tasks.md / global-tasks.md。
 * 组标题：`## 1. [capability] 名称`（`[capability]` 缺失时 capability 为 null）
 * 任务行：`- [ ] 1.1 描述（depends: 1.2, global:3.1）`
 */
/**
 * 解析任务行尾括注：
 * `（depends: 1.2; file: src/a.ts; contract: contracts/api.yaml#POST /x; entity: expenses）`
 * 兼容只有 depends 的旧格式。
 */
export function parseAnnotation(raw) {
  const out = { depends: [], files: [], contracts: [], entities: [], tests: [] }
  for (const part of String(raw ?? '').split(/[;；]/)) {
    const m = /^\s*(depends|file|contract|entity|test)\s*[:：]\s*(.+?)\s*$/i.exec(part)
    if (!m) continue
    const key = m[1].toLowerCase()
    const values = m[2].split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    if (key === 'depends') out.depends.push(...values)
    else if (key === 'file') out.files.push(...values)
    else if (key === 'contract') out.contracts.push(...values)
    else if (key === 'entity') out.entities.push(...values)
    else out.tests.push(...values)
  }
  return out
}

export function parseTasks(md) {
  const lines = String(md ?? '').split(/\r?\n/)
  const groups = []
  const tasks = []
  let group = null
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const gm = GROUP_RE.exec(line)
    if (gm) {
      group = { num: Number(gm[1]), capability: gm[2] ? gm[2].trim() : null, title: gm[3].trim(), tasks: [] }
      groups.push(group)
      continue
    }
    const tm = TASK_RE.exec(line)
    if (tm) {
      const id = tm[2]
      const rest = tm[3]
      const note = ANNOTATION_RE.exec(rest)
      const text = note ? rest.slice(0, note.index).trim() : rest.trim()
      const meta = note ? parseAnnotation(note[1]) : { depends: [], files: [], contracts: [], entities: [], tests: [] }
      const task = {
        id,
        group: id.split('.')[0],
        text,
        done: tm[1].toLowerCase() === 'x',
        depends: meta.depends,
        files: meta.files,
        contracts: meta.contracts,
        entities: meta.entities,
        tests: meta.tests,
        line: i + 1,
      }
      if (group) group.tasks.push(task)
      tasks.push(task)
    }
  }
  return { groups, tasks }
}

export function renderTasks(model) {
  const chunks = ['# Tasks', '']
  for (const g of model.groups) {
    const cap = g.capability ? `[${g.capability}] ` : ''
    chunks.push(`## ${g.num}. ${cap}${g.title}`.trimEnd(), '')
    for (const t of g.tasks) {
      const dep = t.depends && t.depends.length ? `（depends: ${t.depends.join(', ')}）` : ''
      chunks.push(`- [${t.done ? 'x' : ' '}] ${t.id} ${t.text}${dep}`)
    }
    chunks.push('')
  }
  return chunks.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** 勾选/取消某个任务行（只改该行前缀，保留原格式）。 */
export function toggleTaskLine(md, lineNumber, done) {
  const lines = String(md ?? '').split(/\r?\n/)
  const idx = lineNumber - 1
  if (idx < 0 || idx >= lines.length) return String(md ?? '')
  lines[idx] = lines[idx].replace(/^(\s*-\s*\[)([ xX])(\])/, `$1${done ? 'x' : ' '}$3`)
  return lines.join('\n')
}

/** 在指定组末尾追加任务，编号取该组当前最大次序号 +1。 */
export function appendTask(md, groupNum, text) {
  const model = parseTasks(md)
  const group = model.groups.find((g) => g.num === Number(groupNum))
  if (!group) throw new Error(`任务组 ${groupNum} 不存在`)
  const minor = group.tasks.reduce((max, t) => Math.max(max, Number(t.id.split('.')[1] ?? 0)), 0)
  const id = `${group.num}.${minor + 1}`
  const lines = String(md ?? '').split(/\r?\n/)
  let insertAt = lines.length
  for (let i = 0; i < lines.length; i += 1) {
    const gm = GROUP_RE.exec(lines[i])
    if (gm && Number(gm[1]) === Number(groupNum)) {
      insertAt = lines.length
      for (let j = i + 1; j < lines.length; j += 1) {
        if (GROUP_RE.exec(lines[j])) {
          insertAt = j
          break
        }
      }
      break
    }
  }
  while (insertAt > 0 && lines[insertAt - 1].trim() === '') insertAt -= 1
  lines.splice(insertAt, 0, `- [ ] ${id} ${text}`)
  return { md: lines.join('\n'), id }
}

/** 删除某个任务行，保留编号空洞。 */
export function removeTaskLine(md, lineNumber) {
  const lines = String(md ?? '').split(/\r?\n/)
  lines.splice(lineNumber - 1, 1)
  return lines.join('\n')
}

/** 删除一个任务组（连同组内任务），保留其余字节。 */
export function removeGroup(md, groupNum) {
  const lines = String(md ?? '').split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i += 1) {
    const m = GROUP_RE.exec(lines[i])
    if (m && Number(m[1]) === Number(groupNum)) {
      start = i
      break
    }
  }
  if (start < 0) return String(md ?? '')
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (GROUP_RE.exec(lines[i])) {
      end = i
      break
    }
  }
  while (end > start && lines[end - 1].trim() === '') end -= 1
  lines.splice(start, Math.max(1, end - start))
  return lines.join('\n')
}

/** 追加一个任务组；组号取当前最大组号 +1。 */
export function appendGroup(md, capability, title) {
  const model = parseTasks(md)
  const num = model.groups.reduce((max, g) => Math.max(max, Number(g.num) || 0), 0) + 1
  const cap = capability ? `[${capability}] ` : ''
  const text = String(md ?? '').replace(/\s+$/, '')
  return { md: `${text}\n\n## ${num}. ${cap}${title}`.trimEnd() + '\n', num }
}

/* ------------------------------------------------------------------- project */

export function firstHeading(md) {
  const m = /^#\s+(.*)$/m.exec(String(md ?? ''))
  return m ? m[1].trim() : ''
}

/** 产物状态：done / ready / blocked / skipped。design 视为可跳过。 */
export function deriveArtifacts(files) {
  const has = (k) => Boolean(files[k])
  const out = []
  for (const id of ARTIFACT_ORDER) {
    const def = ARTIFACT_DEFS[id]
    if (id === 'tasks') {
      const ready = has('specs') || has('proposal')
      out.push({ id, state: has('tasks') ? 'done' : ready ? 'ready' : 'blocked', optional: def.optional })
      continue
    }
    if (id === 'tech') {
      const ready = has('specs')
      out.push({ id, state: has('tech') ? 'done' : ready ? 'ready' : 'blocked', optional: def.optional })
      continue
    }
    const ready = id === 'proposal' ? true : has('proposal')
    out.push({ id, state: has(id) ? 'done' : ready ? 'ready' : 'blocked', optional: def.optional })
  }
  return out
}

/** 进度：只统计勾选率；没有任务时返回 null（界面显示「—」）。 */
export function progressOf(tasks) {
  const total = tasks.length
  const done = tasks.filter((t) => t.done).length
  return { total, done, ratio: total ? done / total : null }
}

/** 把 design.md 拆成 UI 需要的四个小节（同时保留可直接编辑的原始正文）。 */
export function parseDesign(md) {
  const text = String(md ?? '')
  const raw = {
    context: sectionBody(text, 'Context'),
    goals: sectionBody(text, 'Goals / Non-Goals'),
    decisions: sectionBody(text, 'Decisions'),
    risks: sectionBody(text, 'Risks / Trade-offs'),
    migration: sectionBody(text, 'Migration Plan'),
  }
  const goalsMatch = /\*\*Goals:\*\*([\s\S]*?)(?=\*\*Non-Goals:\*\*|$)/i.exec(raw.goals)
  const nonGoalsMatch = /\*\*Non-Goals:\*\*([\s\S]*)$/i.exec(raw.goals)
  return {
    context: raw.context,
    goals: goalsMatch ? goalsMatch[1].trim() : '',
    nonGoals: nonGoalsMatch ? nonGoalsMatch[1].trim() : '',
    decisions: parseDecisions(raw.decisions),
    risks: raw.risks,
    migration: raw.migration,
    openQuestions: sectionBody(text, 'Open Questions'),
    raw,
  }
}

function parseDecisions(body) {
  return String(body ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => {
      const text = line.replace(/^[-*]\s+/, '')
      const m = /^(.*?)`([^`]+)`(.*)$/.exec(text)
      return m ? { lead: m[1].trim(), code: m[2].trim(), tail: m[3].trim() } : { lead: '', code: text, tail: '' }
    })
}

/** 把 structure.md 里的目录树代码块解析成嵌套结构（兼容 ├── 与纯空格缩进）。 */
export function parseStructureTree(md) {
  const text = String(md ?? '')
  const blocks = [...text.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map((m) => m[1])
  if (!blocks.length) return null
  const block = blocks.find((b) => /[├└│]/.test(b)) ?? blocks[0]

  const items = []
  for (const raw of block.split(/\r?\n/)) {
    if (!raw.trim()) continue
    const m = /^([\s│]*)([├└]── )?(.*)$/.exec(raw)
    if (!m) continue
    const name = m[3].replace(/\s+#.*$/, '').trim()
    if (!name) continue
    items.push({ width: m[1].length, marker: Boolean(m[2]), name })
  }
  if (!items.length) return null

  // 缩进单位：取所有正宽度的最小值（盒线风格是 4，纯空格风格常见 2）
  const positive = items.map((i) => i.width).filter((w) => w > 0)
  const unit = positive.length ? Math.min(...positive) : 2

  const root = { name: '.', children: [], depth: 0 }
  const stack = [{ node: root, depth: -1 }]
  for (const item of items) {
    // 盒线：│   ├── 的 marker 表示“再深一层”；纯缩进：按宽度算
    const depth = item.marker ? Math.round(item.width / unit) + 1 : Math.round(item.width / unit)
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop()
    const node = { name: item.name, depth, children: [] }
    stack[stack.length - 1].node.children.push(node)
    stack.push({ node, depth })
  }
  return root.children.length ? root : null
}

/** 解析 data-model.md：实体字段 + Relations 表。 */
export function parseDataModel(md) {
  const text = String(md ?? '')
  const entities = []
  const relations = []
  const sections = String(text).split(/^##\s+/m).slice(1)
  for (const section of sections) {
    const [firstLine, ...rest] = section.split(/\r?\n/)
    const name = firstLine.trim()
    if (!name) continue
    if (/^relations?$/i.test(name) || /^关系$/i.test(name)) {
      for (const table of parseTables(rest.join('\n'))) {
        const header = table.header
        for (const row of table.rows) {
          const from = pick(row, header, ['from', 'source', '源', '起点'])
          const to = pick(row, header, ['to', 'target', '目标', '终点'])
          if (!from || !to) continue
          relations.push({
            from,
            to,
            type: pick(row, header, ['type', 'cardinality', '关系', '类型']) || '1..n',
            on: pick(row, header, ['on', 'via', '外键', '字段']),
          })
        }
      }
      continue
    }
    const fields = []
    for (const table of parseTables(rest.join('\n'))) {
      if (!table.header.some((h) => h === '字段' || h === 'field' || h === 'name')) continue
      for (const row of table.rows) {
        const fieldName = pick(row, headerOf(table), ['字段', 'field', 'name'])
        if (!fieldName || fieldName === '字段') continue
        fields.push({
          name: fieldName,
          type: pick(row, table.header, ['类型', 'type']),
          constraints: pick(row, table.header, ['约束', 'constraints']),
          defaultValue: pick(row, table.header, ['默认', 'default']),
          index: pick(row, table.header, ['索引', 'index']),
        })
      }
    }
    if (fields.length) entities.push({ name, fields })
  }
  return { entities, relations }
}

function headerOf(table) {
  return table.header
}

function parseTables(md) {
  const tables = []
  let current = null
  for (const line of String(md ?? '').split(/\r?\n/)) {
    if (/^\s*\|/.test(line)) {
      if (!current) {
        current = { header: [], rows: [] }
        tables.push(current)
      }
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      if (!current.header.length) {
        current.header = cells.map((c) => c.toLowerCase())
        continue
      }
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue
      current.rows.push(cells)
    } else {
      current = null
    }
  }
  return tables
}

function pick(row, header, names) {
  for (const name of names) {
    const index = header.indexOf(name)
    if (index >= 0) return String(row[index] ?? '').trim()
  }
  return ''
}

/** 轻校验：不依赖 CLI 的格式检查。 */export function lintChange(change) {
  const issues = []
  if (!change.files.proposal) issues.push({ level: 'warn', message: '缺少 proposal.md', where: 'proposal' })
  for (const cap of change.capabilities) {
    if (cap.hash === null || cap.hash === undefined) {
      issues.push({ level: 'warn', message: `capability ${cap.path} 没有 spec 文件`, where: cap.path })
      continue
    }
    if (!cap.purpose && cap.isNew) {
      issues.push({ level: 'warn', message: `新增 capability ${cap.path} 缺少 Purpose`, where: cap.path })
    }
    for (const req of cap.requirements ?? []) {
      if (!req.scenarios?.length) {
        issues.push({ level: 'error', message: `需求「${req.name}」没有 scenario`, where: cap.path })
      }
    }
  }
  for (const g of change.taskGroups) {
    if (!g.capability) issues.push({ level: 'warn', message: `任务组 ${g.num}「${g.title}」没有 [capability] 标注`, where: 'tasks' })
  }
  const ids = new Set(change.tasks.map((t) => t.id))
  for (const t of change.tasks) {
    for (const d of t.depends) {
      const ref = d.startsWith('global:') ? null : d
      if (ref && !ids.has(ref)) {
        issues.push({ level: 'error', message: `任务 ${t.id} 依赖了不存在的 ${d}`, where: 'tasks' })
      }
    }
  }
  return issues
}

const norm = (value) => String(value ?? '').trim().toLowerCase()
const NO_INTERFACE = /^no-interface/i

/**
 * G1：每条 requirement 在 coverage.md 里有落点（contract/entity 或 no-interface）。
 * G2：每个任务有 file:，引用的契约/实体真实存在。
 */
export function lintTech(change) {
  const issues = []
  const tech = change.tech ?? {}
  if (tech.skipped) {
    issues.push({ level: 'warn', gate: 'tech', message: `已声明 tech-skip：${tech.skipReason || '未填写原因'}` })
    return issues
  }

  const coverage = tech.coverage?.requirements ?? []
  const byName = new Map(coverage.map((row) => [norm(row.requirement), row]))
  const requirements = []
  for (const cap of change.capabilities ?? []) {
    for (const req of cap.requirements ?? []) requirements.push({ capability: cap.path, name: req.name })
  }
  for (const req of requirements) {
    const hit = byName.get(norm(req.name))
    if (!hit) {
      issues.push({ level: 'error', gate: 'G1', message: `requirement「${req.name}」在 tech/coverage.md 中没有落点` })
      continue
    }
    const hasTarget = Boolean(String(hit.contract ?? '').trim() || String(hit.entity ?? '').trim())
    if (!hasTarget && !NO_INTERFACE.test(String(hit.notes ?? ''))) {
      issues.push({
        level: 'error',
        gate: 'G1',
        message: `requirement「${req.name}」没有 contract/entity；确实无接口时请写 no-interface`,
      })
    }
  }

  const contracts = tech.contracts ?? []
  const contractByFile = new Map(contracts.map((c) => [c.file, c.text]))
  const dataModel = tech.dataModel ?? ''
  for (const task of change.tasks ?? []) {
    if (!(task.files?.length) && !(task.tests?.length)) {
      issues.push({ level: 'error', gate: 'G2', message: `任务 ${task.id} 缺少 file:（或 test:），不可执行` })
    }
    for (const ref of task.contracts ?? []) {
      const [file, operation] = String(ref).split('#')
      if (!contractByFile.has(file)) {
        issues.push({ level: 'error', gate: 'G2', message: `任务 ${task.id} 引用的契约不存在：${file}` })
      } else if (operation && !contractByFile.get(file).includes(operation)) {
        issues.push({ level: 'error', gate: 'G2', message: `任务 ${task.id} 引用的操作不存在：${ref}` })
      }
    }
    for (const entity of task.entities ?? []) {
      if (!dataModel) {
        issues.push({ level: 'error', gate: 'G2', message: `任务 ${task.id} 引用了实体 ${entity}，但没有 tech/data-model.md` })
      } else if (!dataModel.includes(entity)) {
        issues.push({ level: 'error', gate: 'G2', message: `任务 ${task.id} 引用的实体不存在：${entity}` })
      }
    }
  }
  return issues
}

/** 把 issues 汇总成门禁状态，UI 用它显示「实现就绪」。 */
export function gateSummary(issues) {
  const pick = (gate) => issues.filter((i) => i.gate === gate)
  const g0 = pick('G0')
  const g1 = pick('G1')
  const g2 = pick('G2')
  const g3 = pick('G3')
  const g4 = pick('G4')
  const g5 = pick('G5')
  return {
    g0: { ok: g0.length === 0, issues: g0 },
    g1: { ok: g1.length === 0, issues: g1 },
    g2: { ok: g2.length === 0, issues: g2 },
    g3: { ok: g3.length === 0, issues: g3 },
    g4: { ok: g4.length === 0, issues: g4 },
    g5: { ok: g5.length === 0, issues: g5 },
    ready: [g0, g1, g2, g3, g4, g5].every((list) => list.length === 0),
  }
}

/**
 * G0 / G4：grill 是强制步骤。
 * - 写 proposal 之前必须先完成需求 grill；
 * - 写 tech/ 之前必须先完成技术 grill。
 * 确认记录的是 grill 文件 hash，改动后失效。
 */
export function lintGrill(change) {
  const issues = []
  const approval = change.grill?.approvals ?? {}
  if (change.files?.proposal && !approval.requirement?.approved) {
    issues.push({
      level: 'error',
      gate: 'G0',
      message: 'proposal 已生成，但需求 grill 未确认（grill/requirement.md）',
    })
  }
  if (change.tech?.exists && !change.tech?.skipped && !approval.tech?.approved) {
    issues.push({
      level: 'error',
      gate: 'G4',
      message: 'tech/ 已生成，但技术 grill 未确认（grill/tech.md）',
    })
  }
  return issues
}

/** G5：TDD —— 每个任务组的第一条必须是测试任务（带 test:）。 */
export function lintTDD(change) {
  const issues = []
  for (const group of change.taskGroups ?? []) {
    const tasks = group.tasks ?? []
    if (!tasks.length) continue
    if (!tasks[0].tests?.length) {
      issues.push({
        level: 'error',
        gate: 'G5',
        message: `任务组 ${group.num} 的第一条必须是测试任务（加 test: 标注），实现任务排在其后`,
      })
    }
  }
  return issues
}

/**
 * G3：工程结构与数据模型必须在 SpecBoard 里被人工确认过；
 * 文件一旦被修改（hash 变化），确认失效，需要重新确认。
 */
export function lintApprovals(change) {
  const issues = []
  const tech = change.tech ?? {}
  if (!tech.exists || tech.skipped) return issues
  const checks = [
    ['structure', 'structure.md', '工程结构'],
    ['dataModel', 'data-model.md', '数据模型'],
  ]
  for (const [kind, file, label] of checks) {
    if (!tech.files?.[kind]) continue
    const approval = tech.approvals?.[kind]
    if (!approval?.approved) {
      issues.push({
        level: 'error',
        gate: 'G3',
        message: `${label}（tech/${file}）尚未在 SpecBoard 确认${approval?.stale ? '，或确认后又被修改' : ''}`,
      })
    }
  }
  return issues
}

/**
 * design 只做「摘要与背景」：一旦它写了 Decisions 而 tech/research 也存在，
 * 就出现两个事实源，警告并指向 tech。
 */
export function lintDesign(change) {
  const issues = []
  const decisions = String(change.design?.raw?.decisions ?? '').trim()
  if (decisions && change.tech?.files?.research) {
    issues.push({
      level: 'warn',
      gate: 'docs',
      message: 'design.md 的 Decisions 与 tech/research.md 重复：技术决策只保留在 tech/research.md',
    })
  }
  return issues
}
