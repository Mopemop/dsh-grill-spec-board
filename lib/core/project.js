/**
 * 通用项目操作：每个函数先解析出适配器，再委托给它。
 * host 只依赖这里，因此换工具不需要改路由层。
 */
import { discoverProjects, requireAdapter } from './registry.js'

export { discoverProjects, listAdapters, resolveAdapter } from './registry.js'

export async function listChanges(root) {
  return (await requireAdapter(root)).listChanges(root)
}

export async function loadProject(root, options = {}) {
  return (await requireAdapter(root)).loadProject(root, options)
}

export async function loadChange(root, id, options = {}) {
  return (await requireAdapter(root)).loadChange(root, id, options)
}

export async function loadGlobalTasks(root) {
  return (await requireAdapter(root)).loadGlobalTasks(root)
}

export async function readMainSpec(root, capability) {
  return (await requireAdapter(root)).readMainSpec(root, capability)
}

export async function saveSection(args) {
  return (await requireAdapter(args.root)).saveSection(args)
}

export async function saveDelta(args) {
  return (await requireAdapter(args.root)).saveDelta(args)
}

export async function saveDocument(args) {
  return (await requireAdapter(args.root)).saveDocument(args)
}

export async function toggleTask(args) {
  return (await requireAdapter(args.root)).toggleTask(args)
}

export async function addTask(args) {
  return (await requireAdapter(args.root)).addTask(args)
}

export async function deleteTask(args) {
  return (await requireAdapter(args.root)).deleteTask(args)
}

export async function addTaskGroup(args) {
  return (await requireAdapter(args.root)).addTaskGroup(args)
}

export async function deleteTaskGroup(args) {
  return (await requireAdapter(args.root)).deleteTaskGroup(args)
}

export async function createChange(args) {
  return (await requireAdapter(args.root)).createChange(args)
}

export async function deleteProject(root) {
  const adapter = await requireAdapter(root)
  if (typeof adapter.deleteProject !== 'function') {
    const error = new Error('当前适配器不支持删除项目')
    error.code = 'UNSUPPORTED'
    throw error
  }
  return adapter.deleteProject(root)
}

export async function approveTech(args) {
  const adapter = await requireAdapter(args.root)
  if (typeof adapter.approveTech !== 'function') {
    const error = new Error('当前适配器不支持确认操作')
    error.code = 'UNSUPPORTED'
    throw error
  }
  return adapter.approveTech(args)
}

export async function runValidate(root, changeId) {
  const adapter = await requireAdapter(root)
  if (typeof adapter.runValidate !== 'function') return { available: false, reason: 'adapter-unsupported' }
  return adapter.runValidate(root, changeId)
}
