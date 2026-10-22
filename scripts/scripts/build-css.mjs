/**
 * 把 Open Design 原型的 <style> 内容转成「作用域限定在 .sb-app 下」的样式表，
 * 避免 .panel / .toolbar / .btn / .empty 这类通用类名污染 DSH 页面。
 *
 * 运行：node scripts/build-css.mjs <源 html> <输出 css>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [, , input, output] = process.argv
if (!input || !output) {
  console.error('usage: node scripts/build-css.mjs <prototype.html> <out.css>')
  process.exit(1)
}

const html = readFileSync(input, 'utf8')
const start = html.indexOf('<style')
if (start < 0) throw new Error('找不到 <style>')
const bodyStart = html.indexOf('>', start) + 1
const end = html.indexOf('</style>', bodyStart)
let css = html.slice(bodyStart, end)

// 关键帧加前缀，避免与宿主同名动画冲突
const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1])
for (const name of keyframes) {
  css = css.replaceAll(`@keyframes ${name}`, `@keyframes sb-${name}`)
  css = css.replaceAll(`animation:${name}`, `animation:sb-${name}`)
  css = css.replaceAll(`animation: ${name}`, `animation: sb-${name}`)
}

function scopeSelector(selector) {
  return selector
    .split(',')
    .map((raw) => {
      const sel = raw.trim()
      if (!sel) return sel
      if (sel.startsWith(':root')) return `.sb-app${sel.slice(':root'.length)}`
      if (sel.startsWith('html[')) return `.sb-app${sel.slice('html'.length)}`
      if (sel === 'html' || sel === 'body') return '.sb-app'
      if (sel.startsWith('.sb-app')) return sel
      return `.sb-app ${sel}`
    })
    .join(',')
}

/** 按大括号切分声明块，递归处理 @media。 */
function transform(block) {
  let out = ''
  let i = 0
  while (i < block.length) {
    const open = block.indexOf('{', i)
    if (open < 0) {
      out += block.slice(i)
      break
    }
    const prelude = block.slice(i, open).trim()
    // 找到匹配的右括号
    let depth = 1
    let j = open + 1
    while (j < block.length && depth > 0) {
      if (block[j] === '{') depth += 1
      else if (block[j] === '}') depth -= 1
      j += 1
    }
    const inner = block.slice(open + 1, j - 1)
    if (/^@(media|supports|container|layer)/i.test(prelude)) {
      out += `${prelude}{${transform(inner)}}\n`
    } else if (/^@(keyframes|font-face|property|charset|import)/i.test(prelude)) {
      out += `${prelude}{${inner}}\n`
    } else {
      out += `${scopeSelector(prelude)}{${inner}}\n`
    }
    i = j
  }
  return out
}

const overridesPath = join(dirname(fileURLToPath(import.meta.url)), 'overrides.css')
let overrides = ''
try {
  overrides = readFileSync(overridesPath, 'utf8')
} catch {}

const scoped = `/* 由 scripts/build-css.mjs 从 Open Design 原型生成，请勿手改 */\n` + transform(css) + `\n/* host overrides */\n` + overrides
writeFileSync(output, scoped, 'utf8')
console.log(`wrote ${output} (${scoped.length} chars, ${keyframes.length} keyframes renamed)`)
