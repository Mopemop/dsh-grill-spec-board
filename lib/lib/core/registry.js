/**
 * 适配器注册表：core 只认 SpecAdapter 契约，不认具体工具。
 * 新增一个规范工具（spec-kit、自有格式…）只需要在 ADAPTERS 里加一项。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import openspec from '../adapters/openspec/store.js'

const ADAPTERS = [openspec]

export function listAdapters() {
  return ADAPTERS.map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
    capabilities: adapter.capabilities ?? {},
  }))
}

export async function resolveAdapter(root) {
  for (const adapter of ADAPTERS) {
    try {
      if (await adapter.detect(root)) return adapter
    } catch {
      // detect 失败视为不匹配
    }
  }
  return null
}

export async function requireAdapter(root) {
  const adapter = await resolveAdapter(root)
  if (!adapter) {
    const error = new Error('这个目录不是可识别的工作区（没有匹配的 spec 适配器）')
    error.code = 'NO_ADAPTER'
    throw error
  }
  return adapter
}

async function isDir(dir) {
  try {
    return (await fs.stat(dir)).isDirectory()
  } catch {
    return false
  }
}

/**
 * 通用发现：遍历目录树，把「能匹配任一适配器」的目录当作项目根。
 * 命中后仍然下探，支持 monorepo 里根项目 + 子项目同时存在。
 */
export async function discoverProjects(roots, maxDepth = 3) {
  const found = new Map()
  const seen = new Set()
  const queue = roots.map((root) => ({ dir: path.resolve(root), depth: 0 }))
  while (queue.length) {
    const { dir, depth } = queue.shift()
    if (seen.has(dir)) continue
    seen.add(dir)
    if (await isDir(dir)) {
      const adapter = await resolveAdapter(dir)
      if (adapter) found.set(dir, { root: dir, name: path.basename(dir), adapter: adapter.id, adapterLabel: adapter.label })
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
