/**
 * Host 半侧：注册 `/dsh-specboard/api` 路由、SSE 刷新通道，以及给 agent 用的
 * `specboard_refresh` 工具。领域逻辑在 lib/core（通用接口）与 lib/adapters/<tool>（实现）。
 */
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  addTask,
  addTaskGroup,
  approveTech,
  createChange,
  deleteProject,
  deleteTask,
  deleteTaskGroup,
  discoverProjects,
  loadChange,
  loadGlobalTasks,
  loadProject,
  readMainSpec,
  runValidate,
  saveDelta,
  saveDocument,
  saveSection,
  toggleTask,
} from './core/project.js'

export const inject = ['webServer']

const PREFIX = '/dsh-specboard/api'
const UI_PREFIX = '/dsh-specboard/ui'
const UI_DIR = fileURLToPath(new URL('../ui/', import.meta.url))
const MAX_BODY = 4 * 1024 * 1024
let lastClientError = null

const UI_MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

async function serveUi(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const rel = decodeURIComponent(url.pathname.slice(UI_PREFIX.length)) || '/index.html'
  const target = path.resolve(UI_DIR, '.' + (rel === '/' ? '/index.html' : rel))
  if (!target.startsWith(path.resolve(UI_DIR))) {
    res.writeHead(403)
    return res.end('forbidden')
  }
  try {
    const body = await fsp.readFile(target)
    res.writeHead(200, {
      'content-type': UI_MIME[path.extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function workspaceRoots(ctx) {
  const roots = new Set()
  try {
    const wd = ctx.get('workingDirectory')
    if (wd?.defaultDirectory) roots.add(path.resolve(wd.defaultDirectory))
  } catch {}
  try {
    const registry = ctx.get('workspaceRegistry')
    if (registry?.list) {
      for (const workspace of registry.list()) {
        const p = workspace?.path ?? workspace?.directory ?? workspace?.root
        if (typeof p === 'string' && p) roots.add(path.resolve(p))
      }
    }
  } catch {}
  roots.add(path.resolve(process.cwd()))
  return [...roots]
}

export function apply(ctx) {
  const subscribers = new Set()

  const broadcast = (reason = 'refresh') => {
    const payload = `event: refresh\ndata: ${JSON.stringify({ reason, at: Date.now() })}\n\n`
    for (const res of [...subscribers]) {
      try {
        res.write(payload)
      } catch {
        subscribers.delete(res)
      }
    }
  }

  ctx.effect(() => {
    try {
      return ctx.webServer.register({
        kind: 'prefix',
        path: PREFIX,
        handler: async (req, res) => {
          try {
            await handle(ctx, req, res, { broadcast, subscribers })
          } catch (error) {
            json(res, 500, { error: String(error?.message ?? error) })
          }
        },
      })
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-specboard] 路由注册失败：${String(error?.message ?? error)}`)
      return () => {}
    }
  }, 'dsh-specboard: /dsh-specboard/api routes')

  // 静态 UI（作用域限定的样式表等）。
  ctx.effect(() => {
    try {
      return ctx.webServer.register({
        kind: 'prefix',
        path: UI_PREFIX,
        handler: (req, res) => serveUi(req, res),
      })
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-specboard] UI 路由注册失败：${String(error?.message ?? error)}`)
      return () => {}
    }
  }, 'dsh-specboard: /dsh-specboard/ui assets')

  // 给 agent 的刷新工具：写完 openspec 文件后调用，面板立即更新。
  ctx.effect(() => {
    const tools = ctx.get('tools')
    if (!tools?.register) return () => {}
    return tools.register({
      name: 'specboard_refresh',
      description:
        'Refresh the SpecBoard panel after writing files under the spec workspace. Call it once after each artifact you finish (proposal, specs, design, tasks) and pass change + artifact so the user is told to review that step in SpecBoard.',
      parameters: {
        type: 'object',
        properties: {
          change: { type: 'string', description: 'Change id you just wrote.' },
          artifact: { type: 'string', enum: ['proposal', 'specs', 'design', 'tasks'], description: 'Which artifact was just written.' },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, at: { type: 'number' }, change: { type: 'string' }, artifact: { type: 'string' } },
          additionalProperties: false,
        },
        render: (_args, value) => [{
          type: 'text',
          text: value?.artifact
            ? `已刷新 SpecBoard：请检查「${value.change ?? ''}」的 ${value.artifact}`
            : `SpecBoard 已刷新（${value?.at ?? Date.now()}）`,
        }],
      },
      async execute(args) {
        const at = Date.now()
        broadcast('tool')
        return { ok: true, at, change: String(args?.change ?? ''), artifact: String(args?.artifact ?? '') }
      },
    })
  }, 'dsh-specboard: specboard_refresh tool')
}

async function handle(ctx, req, res, hub) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const route = url.pathname.slice(PREFIX.length) || '/'
  const method = (req.method ?? 'GET').toUpperCase()

  if (method === 'GET' && route === '/health') return json(res, 200, { ok: true, pid: process.pid })

  if (method === 'GET' && route === '/last-error') return json(res, 200, { error: lastClientError })

  if (method === 'GET' && route === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    res.write(`event: ready\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`)
    hub.subscribers.add(res)
    const timer = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch {
        clearInterval(timer)
        hub.subscribers.delete(res)
      }
    }, 25_000)
    req.on?.('close', () => {
      clearInterval(timer)
      hub.subscribers.delete(res)
    })
    return undefined
  }

  if (method === 'GET' && route === '/projects') {
    const roots = workspaceRoots(ctx)
    const projects = await discoverProjects(roots)
    const out = []
    for (const project of projects) {
      const changes = await loadProject(project.root)
      out.push({
        root: project.root,
        name: project.name,
        changeCount: changes.changes.filter((c) => !c.archived).length,
        archivedCount: changes.changes.filter((c) => c.archived).length,
        global: changes.globalTasks.progress,
        cli: changes.cli,
      })
    }
    return json(res, 200, { projects: out, roots })
  }

  if (method === 'GET' && route === '/project') {
    const root = url.searchParams.get('root')
    const changeId = url.searchParams.get('change') || undefined
    if (!root) return json(res, 400, { error: '缺少 root' })
    const project = await loadProject(path.resolve(root), { changeId })
    return json(res, 200, project)
  }

  if (method === 'GET' && route === '/change') {
    const root = url.searchParams.get('root')
    const id = url.searchParams.get('id')
    const archived = url.searchParams.get('archived') === '1'
    if (!root || !id) return json(res, 400, { error: '缺少 root 或 id' })
    return json(res, 200, await loadChange(path.resolve(root), id, { archived }))
  }

  if (method === 'GET' && route === '/global') {
    const root = url.searchParams.get('root')
    if (!root) return json(res, 400, { error: '缺少 root' })
    return json(res, 200, await loadGlobalTasks(path.resolve(root)))
  }

  if (method === 'GET' && route === '/main-spec') {
    const root = url.searchParams.get('root')
    const capability = url.searchParams.get('capability')
    if (!root || !capability) return json(res, 400, { error: '缺少 root 或 capability' })
    return json(res, 200, { text: await readMainSpec(path.resolve(root), capability) })
  }

  if (method === 'GET' && route === '/validate') {
    const root = url.searchParams.get('root')
    const changeId = url.searchParams.get('change')
    if (!root || !changeId) return json(res, 400, { error: '缺少 root 或 change' })
    return json(res, 200, await runValidate(path.resolve(root), changeId))
  }

  if (method !== 'POST') return json(res, 404, { error: `未知路由 ${method} ${route}` })

  const body = await readBody(req)

  // 客户端错误上报不需要 root，放在项目校验之前。
  if (route === '/client-error') {
    lastClientError = { ...body, at: Date.now() }
    ctx.logger?.warn?.(`[dsh-specboard] client error: ${body?.message ?? 'unknown'}`)
    return json(res, 200, { ok: true })
  }

  const root = body.root ? path.resolve(body.root) : null
  if (!root) return json(res, 400, { error: '缺少 root' })

  switch (route) {
    case '/save-section': {
      const result = await saveSection({
        root,
        changeId: body.changeId,
        artifact: body.artifact,
        capability: body.capability,
        section: body.section,
        content: body.content ?? '',
        expectedHash: body.expectedHash,
      })
      hub.broadcast('save')
      return json(res, 200, result)
    }
    case '/save-delta': {
      const result = await saveDelta({
        root,
        changeId: body.changeId,
        capability: body.capability,
        delta: body.delta,
        expectedHash: body.expectedHash,
        requirePurpose: Boolean(body.requirePurpose),
      })
      hub.broadcast('save')
      return json(res, 200, result)
    }
    case '/save-document': {
      const result = await saveDocument({
        root,
        changeId: body.changeId,
        artifact: body.artifact,
        capability: body.capability,
        content: body.content ?? '',
        expectedHash: body.expectedHash,
      })
      hub.broadcast('save')
      return json(res, 200, result)
    }
    case '/toggle-task': {
      const result = await toggleTask({
        root,
        changeId: body.changeId,
        file: body.file,
        line: Number(body.line),
        done: Boolean(body.done),
      })
      hub.broadcast('toggle')
      return json(res, 200, result)
    }
    case '/approve-tech': {
      const result = await approveTech({
        root,
        changeId: body.changeId,
        kind: body.kind,
      })
      hub.broadcast('approve')
      return json(res, 200, result)
    }
    case '/add-task': {
      const result = await addTask({ root, changeId: body.changeId, file: body.file, group: Number(body.group), text: body.text })
      hub.broadcast('task')
      return json(res, 200, result)
    }
    case '/delete-task': {
      const result = await deleteTask({ root, changeId: body.changeId, file: body.file, line: Number(body.line) })
      hub.broadcast('task')
      return json(res, 200, result)
    }
    case '/add-group': {
      const result = await addTaskGroup({ root, changeId: body.changeId, file: body.file, capability: body.capability, title: body.title })
      hub.broadcast('task')
      return json(res, 200, result)
    }
    case '/delete-group': {
      const result = await deleteTaskGroup({ root, changeId: body.changeId, file: body.file, group: body.group })
      hub.broadcast('task')
      return json(res, 200, result)
    }
    case '/delete-project': {
      const target = path.resolve(body.root)
      const expected = path.basename(target)
      if (String(body.confirm ?? '') !== expected) {
        return json(res, 400, { error: `确认文本不匹配：请输入项目名「${expected}」` })
      }
      const result = await deleteProject(target)
      hub.broadcast('delete-project')
      return json(res, 200, result)
    }
    case '/create-change': {
      const result = await createChange({ root, id: body.id, title: body.title })
      hub.broadcast('create')
      return json(res, 200, result)
    }
    default:
      return json(res, 404, { error: `未知路由 POST ${route}` })
  }
}
