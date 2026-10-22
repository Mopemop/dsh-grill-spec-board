/**
 * 文件系统层：发现 OpenSpec 项目、读取 change、按块写回。
 * 只依赖 node 内置模块，不依赖 openspec CLI。
 */
import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import {
  appendGroup,
  appendTask,
  deriveArtifacts,
  gateSummary,
  lintChange,
  lintDesign,
  lintGrill,
  lintTDD,
  lintTech,
  lintApprovals,
  parseDelta,
  parseDesign,
  parseProposal,
  parseStructureTree,
  parseDataModel,
  parseTasks,
  progressOf,
  removeTaskLine,
  removeGroup,
  renderDelta,
  replaceSection,
  sectionBody,
  toggleTaskLine,
} from './spec.js'

const OPENSPEC = 'openspec'
const GLOBAL_TASKS = 'global-tasks.md'

/** adapter 元信息：UI 用它渲染路径与命令提示，不再写死字面量。 */
export const id = 'openspec'
export const label = 'OpenSpec'
export const labels = {
  changesDir: 'openspec/changes',
  specsDir: 'openspec/specs',
  archiveDir: 'openspec/changes/archive',
  globalTasksFile: 'openspec/global-tasks.md',
  files: { proposal: 'proposal.md', design: 'design.md', tasks: 'tasks.md', spec: 'spec.md' },
  proposeCommand: '/opsx:propose',
  continueCommand: '/opsx:continue',
  proposeHint: '让 AI 执行 /opsx:propose 生成 proposal.md',
  continueHint: '让 AI 执行 /opsx:continue 生成下一件产物',
}

export async function detect(root) {
  const base = path.join(root, OPENSPEC)
  if (!(await isDir(base))) return false
  // 仅有同名目录不够（插件自己的 lib/adapters/openspec 也会命中），必须有 OpenSpec 的实际结构
  return (
    (await isDir(path.join(base, 'changes'))) ||
    (await isDir(path.join(base, 'specs'))) ||
    existsSync(path.join(base, 'config.yaml')) ||
    existsSync(path.join(base, 'config.yml'))
  )
}

export function hashOf(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex').slice(0, 16)
}

async function readText(file) {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

async function isDir(dir) {
  try {
    return (await fs.stat(dir)).isDirectory()
  } catch {
    return false
  }
}

async function listDirs(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

/** 原子写：先写临时文件再 rename，避免半截内容。 */
async function writeAtomic(file, content) {
  const tmp = `${file}.specboard-${process.pid}-${Date.now()}.tmp`
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, file)
}

/* --------------------------------------------------------------- discovery */

/**
 * 在给定根目录下扫描含 `openspec/` 的目录（深度 ≤ maxDepth，跳过 node_modules/.git）。
 * 返回项目描述数组，按路径排序。
 */
export async function discoverProjects(roots, maxDepth = 3) {
  const found = new Map()
  const queue = roots.map((root) => ({ dir: path.resolve(root), depth: 0 }))
  const seen = new Set()
  while (queue.length) {
    const { dir, depth } = queue.shift()
    if (seen.has(dir)) continue
    seen.add(dir)
    const opsDir = path.join(dir, OPENSPEC)
    if (await isDir(opsDir)) {
      found.set(dir, { root: dir, name: path.basename(dir), openspec: opsDir })
      // 找到项目后仍然下探：monorepo 里可能同时存在根项目和子项目。
    }
    if (depth >= maxDepth) continue
    let entries = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue
      queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 })
    }
  }
  return [...found.values()].sort((a, b) => a.root.localeCompare(b.root))
}

/* --------------------------------------------------------------- tech pack */

const TECH_FILES = ['research.md', 'data-model.md', 'structure.md', 'seams.md', 'coverage.md']

/** 解析 markdown 表格（多个表按出现顺序返回）。 */
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

function parseCoverage(md) {
  const domains = []
  const requirements = []
  for (const table of parseTables(md)) {
    const header = table.header
    if (header.some((h) => h === '域' || h === 'domain')) {
      for (const row of table.rows) {
        domains.push({
          domain: pick(row, header, ['域', 'domain']),
          status: pick(row, header, ['状态', 'status']),
          evidence: pick(row, header, ['证据', '证据/决定', 'evidence', 'decision']),
        })
      }
    } else if (header.some((h) => h === 'requirement' || h === '需求')) {
      for (const row of table.rows) {
        requirements.push({
          requirement: pick(row, header, ['requirement', '需求']),
          contract: pick(row, header, ['contract', '契约']),
          entity: pick(row, header, ['entity', '实体']),
          notes: pick(row, header, ['notes', '备注', '说明']),
        })
      }
    }
  }
  return { domains, requirements }
}

async function readTech(changeDir) {
  const dir = path.join(changeDir, 'tech')
  if (!(await isDir(dir))) {
    return { exists: false, skipped: false, files: {}, contracts: [], coverage: { domains: [], requirements: [] } }
  }
  const texts = {}
  for (const name of TECH_FILES) texts[name] = (await readText(path.join(dir, name))) ?? ''

  const contracts = []
  const contractDir = path.join(dir, 'contracts')
  if (await isDir(contractDir)) {
    try {
      const entries = await fs.readdir(contractDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        contracts.push({
          file: `contracts/${entry.name}`,
          text: (await readText(path.join(contractDir, entry.name))) ?? '',
        })
      }
    } catch {}
  }

  const skip = /^\s*tech-skip\s*[:：]\s*(.*)$/im.exec(texts['coverage.md'])
  let stored = {}
  try {
    stored = JSON.parse(await readText(path.join(dir, 'approvals.json')) || '{}') || {}
  } catch {}
  const approvalOf = (kind, text) => {
    const current = text.trim() ? hashOf(text) : null
    const record = stored?.[kind]
    return {
      hash: current,
      at: record?.at ?? null,
      approved: Boolean(record?.hash && current && record.hash === current),
      stale: Boolean(record?.hash && current && record.hash !== current),
    }
  }
  return {
    exists: true,
    skipped: Boolean(skip),
    skipReason: skip ? skip[1].trim() : '',
    files: {
      research: Boolean(texts['research.md'].trim()),
      dataModel: Boolean(texts['data-model.md'].trim()),
      structure: Boolean(texts['structure.md'].trim()),
      seams: Boolean(texts['seams.md'].trim()),
      coverage: Boolean(texts['coverage.md'].trim()),
      contracts: contracts.length,
    },
    research: texts['research.md'],
    dataModel: texts['data-model.md'],
    structure: texts['structure.md'],
    seams: texts['seams.md'],
    contracts,
    coverage: parseCoverage(texts['coverage.md']),
    approvals: {
      structure: approvalOf('structure', texts['structure.md']),
      dataModel: approvalOf('dataModel', texts['data-model.md']),
    },
    structureTree: parseStructureTree(texts['structure.md']),
    dataModelModel: parseDataModel(texts['data-model.md']),
  }
}

/* ------------------------------------------------------------- grill files */

async function readGrill(changeDir) {
  const dir = path.join(changeDir, 'grill')
  const exists = await isDir(dir)
  const texts = { requirement: '', tech: '' }
  if (exists) {
    texts.requirement = (await readText(path.join(dir, 'requirement.md'))) ?? ''
    texts.tech = (await readText(path.join(dir, 'tech.md'))) ?? ''
  }
  let stored = {}
  try {
    stored = JSON.parse((await readText(path.join(dir, 'approvals.json'))) || '{}') || {}
  } catch {}
  const approvalOf = (key, text) => {
    const current = text.trim() ? hashOf(text) : null
    const record = stored?.[key]
    return {
      hash: current,
      at: record?.at ?? null,
      approved: Boolean(record?.hash && current && record.hash === current),
      stale: Boolean(record?.hash && current && record.hash !== current),
    }
  }
  return {
    exists,
    files: {
      requirement: Boolean(texts.requirement.trim()),
      tech: Boolean(texts.tech.trim()),
    },
    requirement: texts.requirement,
    tech: texts.tech,
    approvals: {
      requirement: approvalOf('requirement', texts.requirement),
      tech: approvalOf('tech', texts.tech),
    },
  }
}

/* ------------------------------------------------------------------ loading */

async function loadCapability(root, changeDir, capPath, isNew) {
  const deltaFile = path.join(changeDir, 'specs', capPath, 'spec.md')
  const deltaText = await readText(deltaFile)
  const mainFile = path.join(root, OPENSPEC, 'specs', capPath, 'spec.md')
  const mainText = await readText(mainFile)
  const delta = deltaText === null ? null : parseDelta(deltaText)
  const main = mainText === null ? null : parseDelta(mainText)
  return {
    path: capPath,
    name: capPath.split('/').pop(),
    isNew: Boolean(isNew),
    // 通用模型：requirement 直接挂在 capability 上，不暴露 delta 这一层
    requirements: delta?.requirements ?? [],
    purpose: delta?.purpose ?? '',
    hash: deltaText === null ? null : hashOf(deltaText),
    mainRequirements: (main?.requirements ?? []).map((r) => ({ name: r.name, scenarios: r.scenarios?.length ?? 0 })),
    files: {
      delta: deltaText === null ? null : path.relative(root, deltaFile).replace(/\\/g, '/'),
      main: mainText === null ? null : path.relative(root, mainFile).replace(/\\/g, '/'),
    },
  }
}

export async function loadChange(root, id, { archived = false } = {}) {
  const changeDir = archived
    ? await resolveArchivedDir(root, id)
    : path.join(root, OPENSPEC, 'changes', id)
  const proposalText = await readText(path.join(changeDir, 'proposal.md'))
  const designText = await readText(path.join(changeDir, 'design.md'))
  const tasksText = await readText(path.join(changeDir, 'tasks.md'))
  const proposal = proposalText ? parseProposal(proposalText) : null
  const taskModel = tasksText ? parseTasks(tasksText) : { groups: [], tasks: [] }

  const declared = [...(proposal?.newCapabilities ?? []).map((c) => ({ ...c, isNew: true })),
    ...(proposal?.modifiedCapabilities ?? []).map((c) => ({ ...c, isNew: false }))]
  const deltaDirs = await listDirs(path.join(changeDir, 'specs'))
  const paths = new Map()
  for (const d of declared) paths.set(d.path, d.isNew)
  for (const d of deltaDirs) if (!paths.has(d)) paths.set(d, false)

  const capabilities = []
  for (const [capPath, isNew] of paths) {
    capabilities.push(await loadCapability(root, changeDir, capPath, isNew))
  }

  const designModel = designText === null ? null : parseDesign(designText)
  const tech = await readTech(changeDir)
  const grill = await readGrill(changeDir)
  const techFilesPresent = Boolean(tech.files.coverage || tech.files.structure || tech.files.dataModel)
  const files = {
    proposal: Boolean(proposalText),
    specs: capabilities.some((c) => c.hash !== null),
    design: Boolean(designText),
    tech: techFilesPresent,
    tasks: Boolean(tasksText),
  }
  const artifacts = deriveArtifacts(files)
  const change = {
    id,
    archived,
    dir: path.relative(root, changeDir).replace(/\\/g, '/'),
    title: proposal?.title && proposal.title !== 'Proposal' ? proposal.title : id,
    files,
    hashes: {
      proposal: proposalText === null ? null : hashOf(proposalText),
      design: designText === null ? null : hashOf(designText),
      tasks: tasksText === null ? null : hashOf(tasksText),
    },
    proposal,
    design: designModel === null ? null : { sections: designModel, raw: designModel.raw },
    tech,
    grill,
    capabilities,
    tasks: taskModel.tasks,
    taskGroups: taskModel.groups,
    artifacts,
    progress: progressOf(taskModel.tasks),
    mtime: await mtimeOf(changeDir),
  }
  change.issues = [
    ...lintChange(change),
    ...lintTech(change),
    ...lintDesign(change),
    ...lintApprovals(change),
    ...lintGrill(change),
    ...lintTDD(change),
  ]
  change.gates = gateSummary(change.issues)
  return change
}

async function resolveArchivedDir(root, id) {
  const archiveRoot = path.join(root, OPENSPEC, 'changes', 'archive')
  const dirs = await listDirs(archiveRoot)
  const hit = dirs.find((d) => d === id || d.endsWith(`-${id}`) || d.includes(id))
  if (!hit) throw new Error(`归档 change ${id} 不存在`)
  return path.join(archiveRoot, hit)
}

async function mtimeOf(dir) {
  try {
    return (await fs.stat(dir)).mtimeMs
  } catch {
    return 0
  }
}

export async function listChanges(root) {
  const changesDir = path.join(root, OPENSPEC, 'changes')
  const active = await listDirs(changesDir)
  const archived = await listDirs(path.join(changesDir, 'archive'))
  const out = []
  for (const id of active) {
    const dir = path.join(changesDir, id)
    const [proposal, tasks] = await Promise.all([
      readText(path.join(dir, 'proposal.md')),
      readText(path.join(dir, 'tasks.md')),
    ])
    if (proposal === null && tasks === null) continue
    const taskModel = tasks ? parseTasks(tasks) : { tasks: [] }
    const files = {
      proposal: proposal !== null,
      tasks: tasks !== null,
      design: (await readText(path.join(dir, 'design.md'))) !== null,
      specs: (await listDirs(path.join(dir, 'specs'))).length > 0,
    }
    const capDirs = await listDirs(path.join(dir, 'specs'))
    let requirementCount = 0
    for (const cap of capDirs) {
      const delta = await readText(path.join(dir, 'specs', cap, 'spec.md'))
      if (delta) requirementCount += (delta.match(/^###\s+Requirement:/gm) ?? []).length
    }
    out.push({
      id,
      archived: false,
      title: proposal ? propTitle(proposal, id) : id,
      files,
      artifacts: deriveArtifacts(files),
      progress: progressOf(taskModel.tasks),
      capabilityCount: capDirs.length,
      requirementCount,
      mtime: await mtimeOf(dir),
    })
  }
  for (const id of archived) {
    out.push({
      id,
      archived: true,
      title: id,
      files: {},
      artifacts: [],
      progress: { total: 0, done: 0, ratio: null },
      capabilityCount: 0,
      requirementCount: 0,
      mtime: 0,
    })
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

function propTitle(md, fallback) {
  const m = /^#\s+Proposal\s*\n+\s*\*\*?([^\n*]+)/.exec(md)
  if (m) return m[1].trim()
  const h = /^#\s+(.*)$/m.exec(md)
  const title = h ? h[1].trim() : ''
  return title && !/^proposal$/i.test(title) ? title : fallback
}

export async function loadGlobalTasks(root) {
  const file = path.join(root, OPENSPEC, GLOBAL_TASKS)
  const text = await readText(file)
  if (text === null) return { exists: false, groups: [], tasks: [], progress: progressOf([]), hash: null, file: `${OPENSPEC}/${GLOBAL_TASKS}` }
  const model = parseTasks(text)
  return {
    exists: true,
    groups: model.groups,
    tasks: model.tasks,
    progress: progressOf(model.tasks),
    hash: hashOf(text),
    file: `${OPENSPEC}/${GLOBAL_TASKS}`,
  }
}

export async function loadProject(root, { changeId } = {}) {
  const changes = await listChanges(root)
  const globalTasks = await loadGlobalTasks(root)
  const activeChange = changeId ? await loadChange(root, changeId, { archived: changes.find((c) => c.id === changeId)?.archived }) : null

  // 任务图的全局视图：所有未归档 change 的任务 + 全局任务，扁平化并带上归属。
  const allTasks = []
  for (const change of changes) {
    if (change.archived) continue
    const text = await readText(path.join(root, OPENSPEC, 'changes', change.id, 'tasks.md'))
    if (text === null) continue
    const model = parseTasks(text)
    for (const group of model.groups) {
      for (const task of group.tasks) {
        allTasks.push({
          changeId: change.id,
          file: 'tasks',
          group: group.num,
          capability: group.capability,
          groupTitle: group.title,
          ...task,
        })
      }
    }
  }
  for (const group of globalTasks.groups) {
    for (const task of group.tasks) {
      allTasks.push({
        changeId: null,
        file: 'global',
        group: group.num,
        capability: group.capability,
        groupTitle: group.title,
        ...task,
      })
    }
  }

  return {
    root,
    name: path.basename(root),
    adapter: { id, label },
    labels,
    changes,
    globalTasks,
    allTasks,
    change: activeChange,
    cli: await detectCli(root),
  }
}

let cliCache

/**
 * 解析 CLI 调用方式：优先 PATH，其次 npm 全局目录（Host 进程的 PATH 可能不含 npm bin）。
 * 返回 { file, args, label }，实际参数追加在 args 之后。
 */
function cliInvocation(args) {
  const override = process.env.OPENSPEC_CLI
  if (override) return { file: override, args }
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA
    if (appdata) {
      const shim = path.join(appdata, 'npm', 'openspec.cmd')
      if (existsSync(shim)) return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/c', shim, ...args] }
    }
  }
  return { file: 'openspec', args }
}

async function runCli(args, cwd, timeout = 10_000) {
  const { execFile } = await import('node:child_process')
  const invocation = cliInvocation(args)
  return new Promise((resolve) => {
    execFile(invocation.file, invocation.args, { cwd, timeout, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

async function detectCli(root) {
  if (cliCache && cliCache.root === root && Date.now() - cliCache.at < 60_000) return cliCache.value
  const { error, stdout } = await runCli(['--version'], root, 6000)
  const value = error ? { available: false } : { available: true, version: stdout.trim() }
  cliCache = { root, at: Date.now(), value }
  return value
}

/* -------------------------------------------------------------------- write */

function changeFile(root, id, rel) {
  return path.join(root, OPENSPEC, 'changes', id, rel)
}

const ARTIFACT_FILE = {
  proposal: 'proposal.md',
  design: 'design.md',
  tasks: 'tasks.md',
}

/**
 * 保存某个 section 的正文。expectedHash 与当前文件不一致时拒绝（冲突）。
 * artifact: proposal | design | tasks | spec
 */
export async function saveSection({ root, changeId, artifact, capability, section, content, expectedHash }) {
  const rel = artifact === 'spec' ? path.join('specs', capability, 'spec.md') : ARTIFACT_FILE[artifact]
  if (!rel) throw new Error(`未知文档 ${artifact}`)
  const file = changeFile(root, changeId, rel)
  const current = await fs.readFile(file, 'utf8')
  if (expectedHash && hashOf(current) !== expectedHash) {
    const error = new Error('文件已被其他写入修改')
    error.code = 'CONFLICT'
    error.currentHash = hashOf(current)
    error.currentText = current
    throw error
  }
  const next = replaceSection(current, section, content)
  await writeAtomic(file, next)
  return { hash: hashOf(next), text: next }
}

export async function saveDocument({ root, changeId, artifact, capability, content, expectedHash }) {
  const rel = artifact === 'spec' ? path.join('specs', capability, 'spec.md') : ARTIFACT_FILE[artifact]
  if (!rel) throw new Error(`未知文档 ${artifact}`)
  const file = changeFile(root, changeId, rel)
  const current = await fs.readFile(file, 'utf8')
  if (expectedHash && hashOf(current) !== expectedHash) {
    const error = new Error('文件已被其他写入修改')
    error.code = 'CONFLICT'
    error.currentHash = hashOf(current)
    error.currentText = current
    throw error
  }
  await writeAtomic(file, content)
  return { hash: hashOf(content) }
}

function taskFilePath(root, changeId, file) {
  return file === 'global'
    ? path.join(root, OPENSPEC, GLOBAL_TASKS)
    : changeFile(root, changeId, 'tasks.md')
}

/** 在写盘前按 OpenSpec 的硬规则做一次校验，避免产出 CLI 会拒绝的文件。 */
export function validateDelta(delta, { requirePurpose = false } = {}) {
  const problems = []
  const requirements = delta?.requirements ?? []
  if (!requirements.length) problems.push('至少需要一条 requirement')
  if (requirePurpose && String(delta?.purpose ?? '').trim().length < 50) {
    problems.push('新增 capability 的 Purpose 至少 50 字符')
  }
  for (const r of requirements) {
    const name = String(r.name ?? '').trim()
    const op = r.op ?? 'ADDED'
    if (!name) problems.push('存在没有名称的 requirement')
    if (op === 'REMOVED') {
      if (!String(r.reason ?? '').trim()) problems.push(`「${name}」REMOVED 需要 Reason`)
      if (!String(r.migration ?? '').trim()) problems.push(`「${name}」REMOVED 需要 Migration`)
      continue
    }
    if (op === 'RENAMED') {
      if (!String(r.from ?? '').trim() || !String(r.to ?? '').trim()) problems.push(`「${name}」RENAMED 需要 FROM 与 TO`)
      continue
    }
    if (!String(r.description ?? '').trim()) problems.push(`「${name || '未命名'}」缺少描述`)
    if (String(r.description ?? '').length > 500) problems.push(`「${name}」描述超过 500 字符（CLI --strict 会报错）`)
    const scenarios = r.scenarios ?? []
    if (!scenarios.length) problems.push(`「${name}」至少需要一个 scenario`)
    for (const s of scenarios) {
      if (!String(s.when ?? '').trim() || !String(s.then ?? '').trim()) {
        problems.push(`「${name}」的 scenario「${s.name || '未命名'}」缺少 WHEN 或 THEN`)
      }
    }
  }
  return problems
}

/** 保存一个 capability 的 delta spec（结构化 requirement/scenario）。 */
export async function saveDelta({ root, changeId, capability, delta, expectedHash, requirePurpose }) {
  if (!capability) throw new Error('缺少 capability')
  const problems = validateDelta(delta, { requirePurpose })
  if (problems.length) {
    const error = new Error(problems.join('；'))
    error.code = 'INVALID'
    throw error
  }
  const file = path.join(root, OPENSPEC, 'changes', changeId, 'specs', capability, 'spec.md')
  const current = await fs.readFile(file, 'utf8')
  if (expectedHash && hashOf(current) !== expectedHash) {
    const error = new Error('文件已被其他写入修改')
    error.code = 'CONFLICT'
    throw error
  }
  const next = renderDelta(delta)
  await writeAtomic(file, next)
  return { hash: hashOf(next) }
}

export async function toggleTask({ root, changeId, file, line, done }) {
  const target = taskFilePath(root, changeId, file)
  const current = await fs.readFile(target, 'utf8')
  const next = toggleTaskLine(current, line, done)
  if (next !== current) await writeAtomic(target, next)
  const model = parseTasks(next)
  return { hash: hashOf(next), progress: progressOf(model.tasks) }
}

export async function addTask({ root, changeId, file, group, text }) {
  const target = taskFilePath(root, changeId, file)
  const current = await fs.readFile(target, 'utf8')
  const result = appendTask(current, group, text)
  await writeAtomic(target, result.md)
  return { id: result.id, hash: hashOf(result.md) }
}

export async function deleteTask({ root, changeId, file, line }) {
  const target = taskFilePath(root, changeId, file)
  const current = await fs.readFile(target, 'utf8')
  const next = removeTaskLine(current, line)
  await writeAtomic(target, next)
  return { hash: hashOf(next) }
}

export async function addTaskGroup({ root, changeId, file, capability, title }) {
  const target = taskFilePath(root, changeId, file)
  const current = (await readText(target)) ?? '# Tasks\n'
  const result = appendGroup(current, capability, title)
  await writeAtomic(target, result.md)
  return { num: result.num, hash: hashOf(result.md) }
}

export async function deleteTaskGroup({ root, changeId, file, group }) {
  const target = taskFilePath(root, changeId, file)
  const current = await fs.readFile(target, 'utf8')
  const next = removeGroup(current, Number(group))
  await writeAtomic(target, next)
  return { hash: hashOf(next) }
}

/** 有 CLI 时用官方 validate 做一次交叉校验；没有就返回 available:false。 */
export async function runValidate(root, changeId) {
  if (!/^[A-Za-z0-9._-]+$/.test(String(changeId ?? ''))) {
    return { available: true, ok: false, stdout: '', stderr: '非法的 change id' }
  }
  const { error, stdout, stderr } = await runCli(['validate', changeId, '--json'], root, 12_000)
  if (error && (error.code === 'ENOENT' || error.code === 'EACCES')) return { available: false }
  return { available: true, ok: !error, stdout, stderr }
}

/** 新建 change 骨架：proposal.md + tasks.md（不写 .openspec.yaml，沿用默认 schema）。 */
export async function createChange({ root, id, title }) {
  const safe = String(id ?? '').trim()
  if (!/^[a-z0-9][a-z0-9-]*$/.test(safe)) throw new Error('change id 只能是小写字母、数字与连字符')
  const dir = path.join(root, OPENSPEC, 'changes', safe)
  if (await isDir(dir)) throw new Error(`change ${safe} 已存在`)
  await fs.mkdir(dir, { recursive: true })
  const name = String(title ?? safe).trim()
  const proposal = [
    '# Proposal',
    '',
    '## Why',
    '',
    `<!-- ${name}：为什么要做这个变更 -->`,
    '',
    '## What Changes',
    '',
    '<!-- 具体改什么：新增能力、修改、删除 -->',
    '',
    '## Capabilities',
    '',
    '### New Capabilities',
    '',
    '- `<capability-path>`: <这个能力覆盖什么>',
    '',
    '### Modified Capabilities',
    '',
    '',
    '## Impact',
    '',
    '<!-- 影响的代码、API、依赖、系统 -->',
    '',
  ].join('\n')
  const tasks = ['# Tasks', '', '## 1. [global] 基础准备', '', '- [ ] 1.1 明确验收口径', ''].join('\n')
  await fs.writeFile(path.join(dir, 'proposal.md'), proposal, 'utf8')
  await fs.writeFile(path.join(dir, 'tasks.md'), tasks, 'utf8')
  return { id: safe, dir: path.relative(root, dir).replace(/\\/g, '/') }
}

export async function readMainSpec(root, capability) {
  const text = await readText(path.join(root, OPENSPEC, 'specs', capability, 'spec.md'))
  return text === null ? null : { text, purpose: sectionBody(text, 'Purpose') }
}

/** 人工确认某份结构 / grill 记录（保存当前文件 hash），之后任何修改都会让确认失效。 */
export async function approveTech({ root, changeId, kind }) {
  const targets = {
    structure: { dir: 'tech', file: 'structure.md', key: 'structure' },
    dataModel: { dir: 'tech', file: 'data-model.md', key: 'dataModel' },
    requirementGrill: { dir: 'grill', file: 'requirement.md', key: 'requirement' },
    techGrill: { dir: 'grill', file: 'tech.md', key: 'tech' },
  }
  const target = targets[kind]
  if (!target) throw new Error(`未知的确认项：${kind}`)
  const changeDir = path.join(root, OPENSPEC, 'changes', changeId)
  const filePath = path.join(changeDir, target.dir, target.file)
  const text = await fs.readFile(filePath, 'utf8')
  const approvalsPath = path.join(changeDir, target.dir, 'approvals.json')
  let approvals = {}
  try {
    approvals = JSON.parse((await readText(approvalsPath)) || '{}') || {}
  } catch {}
  approvals[target.key] = { hash: hashOf(text), at: Date.now() }
  await writeAtomic(approvalsPath, JSON.stringify(approvals, null, 2) + '\n')
  return { kind, hash: approvals[target.key].hash, at: approvals[target.key].at }
}

/** 删除项目的规格目录（只删 <root>/openspec，不碰代码）。 */
export async function deleteProject(root) {
  const absRoot = path.resolve(root)
  const base = path.join(absRoot, OPENSPEC)
  const info = await fs.lstat(base).catch(() => null)
  if (!info || !info.isDirectory()) {
    const error = new Error('找不到 openspec 目录')
    error.code = 'NOT_FOUND'
    throw error
  }
  let files = 0
  const walk = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(target)
      else files += 1
    }
  }
  await walk(base)
  await fs.rm(base, { recursive: true, force: true })
  // 如果项目目录因此变空（常见于只为规格创建的空目录），一并移除；有代码则保留。
  let rootRemoved = false
  try {
    const remaining = await fs.readdir(absRoot)
    if (remaining.length === 0) {
      await fs.rmdir(absRoot)
      rootRemoved = true
    }
  } catch {}
  return { root: absRoot, removed: path.join(absRoot, OPENSPEC), files, rootRemoved }
}

/** 适配器契约：core 只通过这个对象访问 OpenSpec。 */
export default {
  id,
  label,
  labels,
  detect,
  capabilities: { delta: true, archive: true, globalTasks: true, design: true, validate: true },
  discoverProjects,
  listChanges,
  loadChange,
  loadProject,
  loadGlobalTasks,
  saveSection,
  saveDelta,
  saveDocument,
  toggleTask,
  addTask,
  deleteTask,
  addTaskGroup,
  deleteTaskGroup,
  createChange,
  readMainSpec,
  runValidate,
  deleteProject,
  approveTech,
}

