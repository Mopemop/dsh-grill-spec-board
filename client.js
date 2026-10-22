// SpecBoard — Client half (React). 视觉来自 Open Design 原型（ui/style.css），
// 数据与写操作走 Host 的 /dsh-specboard/api。模块按功能分段：
//   1. api  2. 基础 UI  3. 列表  4. 详情  5. 任务图  6. 外壳
window.__ModuleLoader__.load({
  id: 'dsh-specboard',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const PANEL_ID = 'specboard'
    const API = '/dsh-specboard/api'
    const THEME_KEY = 'specboard.theme'
    const ROOT_KEY = 'specboard.root'

    /** UI 文案里所有工具相关字面量都来自当前适配器的 labels。 */
    const DEFAULT_LABELS = {
      adapterLabel: '',
      changesDir: 'changes',
      specsDir: 'specs',
      globalTasksFile: 'tasks/global.md',
      files: { proposal: 'proposal.md', design: 'design.md', tasks: 'tasks.md' },
      proposeHint: '让 AI 生成 proposal',
      continueHint: '让 AI 生成下一件产物',
    }
    let LABELS = DEFAULT_LABELS

    /* -------------------------------------------------------------------- api */

    async function api(path, options) {
      const res = await fetch(API + path, { headers: { 'content-type': 'application/json' }, ...options })
      const text = await res.text()
      let value = {}
      try {
        value = text ? JSON.parse(text) : {}
      } catch {
        throw new Error(`响应不是 JSON：${text.slice(0, 160)}`)
      }
      if (!res.ok) {
        const error = new Error(value?.error ?? `HTTP ${res.status}`)
        error.payload = value
        throw error
      }
      return value
    }
    const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })
    const qs = (params) =>
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')

    /* ------------------------------------------------------------------ icons */

    const ICONS = {
      spec: [['path', { d: 'M6 3.5h7.5L18 8v12.5H6z' }], ['path', { d: 'M13.5 3.5V8H18' }], ['path', { d: 'M9 12h6M9 15.5h4.5' }]],
      folder: [['path', { d: 'M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5z' }]],
      'chevron-down': [['path', { d: 'M6 9.5l6 6 6-6' }]],
      'chevron-right': [['path', { d: 'M9.5 6l6 6-6 6' }]],
      refresh: [['path', { d: 'M20 11a8 8 0 1 0-.9 4.4' }], ['path', { d: 'M20 5v6h-6' }]],
      moon: [['path', { d: 'M20 14.2A8.2 8.2 0 0 1 9.8 4 8.2 8.2 0 1 0 20 14.2z' }]],
      sun: [['circle', { cx: 12, cy: 12, r: 4 }], ['path', { d: 'M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4' }]],
      list: [['path', { d: 'M8 6h12M8 12h12M8 18h12' }], ['path', { d: 'M4 6h.01M4 12h.01M4 18h.01' }]],
      branch: [['circle', { cx: 6, cy: 5, r: 2 }], ['circle', { cx: 18, cy: 6, r: 2 }], ['circle', { cx: 6, cy: 19, r: 2 }], ['path', { d: 'M6 7v10M8 12h4a6 6 0 0 0 6-6' }]],
      plus: [['path', { d: 'M12 5v14M5 12h14' }]],
      check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
      lock: [['rect', { x: 5, y: 10.5, width: 14, height: 9.5, rx: 2 }], ['path', { d: 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5' }]],
      alert: [['path', { d: 'M12 4 21 20H3z' }], ['path', { d: 'M12 9v5M12 17h.01' }]],
      'check-circle': [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M8.3 12.2l2.5 2.5 5-5' }]],
      'arrow-left': [['path', { d: 'M19 12H5M11 6l-6 6 6 6' }]],
      layers: [['path', { d: 'M12 3.5 21 8l-9 4.5L3 8z' }], ['path', { d: 'M3 12.5 12 17l9-4.5' }], ['path', { d: 'M3 16.5 12 21l9-4.5' }]],
    }

    function Icon({ name, cls = '' }) {
      const shapes = ICONS[name] ?? []
      return h('svg', {
        className: `i ${cls}`,
        viewBox: '0 0 24 24',
        'aria-hidden': true,
        focusable: 'false',
      },
        shapes.map(([tag, props], index) => h(tag, { key: index, ...props })))
    }

    /* --------------------------------------------------------------- mapping */

    const artifactMap = (artifacts) => {
      const out = { proposal: 'blocked', specs: 'blocked', design: 'blocked', tasks: 'blocked' }
      for (const a of artifacts ?? []) {
        out[a.id] = a.state === 'done' ? 'done' : a.state === 'ready' ? 'pending' : 'blocked'
      }
      return out
    }
    const capsOf = (change) =>
      (change?.capabilities ?? []).map((cap) => ({
        id: cap.path,
        kind: cap.isNew ? 'added' : 'modified',
        purpose: cap.purpose ?? '',
        hash: cap.hash ?? null,
        requirements: (cap.requirements ?? []).map((r) => ({
          op: r.op,
          title: r.name,
          text: r.description,
          reason: r.reason ?? '',
          migration: r.migration ?? '',
          from: r.from ?? '',
          to: r.to ?? '',
          scenarios: (r.scenarios ?? []).map((s) => ({ name: s.name, when: s.when, then: s.then })),
        })),
        main: (cap.mainRequirements ?? []).map((r) => ({
          name: r.name,
          scenarios: r.scenarios ?? 0,
        })),
      }))
    const groupsOf = (groups) =>
      (groups ?? []).map((g) => ({
        index: g.num,
        cap: g.capability ?? 'global',
        title: g.title,
        tasks: (g.tasks ?? []).map((t) => ({
          num: t.id,
          title: t.text,
          done: t.done,
          depends: t.depends ?? [],
          files: t.files ?? [],
          contracts: t.contracts ?? [],
          entities: t.entities ?? [],
          tests: t.tests ?? [],
          line: t.line,
        })),
      }))
    const statsOf = (groups) => {
      const tasks = (groups ?? []).flatMap((g) => g.tasks)
      return { done: tasks.filter((t) => t.done).length, total: tasks.length }
    }
    const reqCount = (caps) => caps.reduce((n, c) => n + c.requirements.length, 0)
    const scenarioCount = (caps) => caps.reduce((n, c) => n + c.requirements.reduce((m, r) => m + r.scenarios.length, 0), 0)
    const titleOf = (id) => id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

    /* ------------------------------------------------------------------- ui */

    function Progress({ done, total, extra }) {
      const pct = total ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0
      const complete = total > 0 && done === total
      return h('div', {
        className: `progress ${complete ? 'is-complete' : ''} ${extra ?? ''}`,
        role: 'progressbar',
        'aria-valuemin': 0,
        'aria-valuemax': Math.max(total, 1),
        'aria-valuenow': done,
        'aria-label': `任务进度 ${done}/${total}`,
      }, h('span', { style: { width: `${pct}%` } }))
    }

    const ARTIFACT_STATES = { done: '已完成', pending: '待生成', blocked: '阻塞' }

    function Artifacts({ art, large }) {
      return h('div', { className: `artifacts ${large ? 'is-lg' : ''}` },
        ['proposal', 'specs', 'design', 'tech', 'tasks'].map((name) => {
          const state = art?.[name] ?? 'blocked'
          return h('span', {
            key: name,
            className: `artifact is-${state} ${name === 'design' ? 'skippable' : ''}`,
            title: `${name} · ${ARTIFACT_STATES[state]}${name === 'design' ? ' · 可跳过' : ''}`,
          },
            h('span', { className: 'artifact-label' }, name),
            h('span', { className: 'artifact-box' },
              state === 'done' ? h(Icon, { name: 'check', cls: 'i-sm' }) : state === 'pending' ? h('span', { className: 'artifact-dot' }, '·') : null))
        }))
    }

    function Legend() {
      return h('div', { className: 'artifact-legend', 'aria-label': '产物状态图例' },
        h('span', { className: 'legend-item' }, h('span', { className: 'legend-box is-done' }, h(Icon, { name: 'check', cls: 'i-sm' })), '已完成'),
        h('span', { className: 'legend-item' }, h('span', { className: 'legend-box is-pending' }, '·'), '待生成'),
        h('span', { className: 'legend-item' }, h('span', { className: 'legend-box is-blocked' }), '阻塞'),
        h('span', { className: 'legend-note' }, 'design 可跳过'))
    }

    function PageHead({ title, sub, right }) {
      return h('div', { className: 'page-head' },
        h('div', null, h('h1', { className: 'page-title' }, title), h('p', { className: 'page-sub' }, sub)),
        right ? h('div', { className: 'page-head-side' }, right) : null)
    }

    function Badge({ change, onClick }) {
      const hints = (change?.issues ?? []).map((i) => i.message)
      const ok = hints.length === 0
      return h('button', {
        className: `badge ${ok ? 'badge-ok' : 'badge-warn'}`,
        onClick,
        title: ok ? 'proposal / specs / tasks 结构完整' : hints.join('；'),
      }, h(Icon, { name: ok ? 'check-circle' : 'alert', cls: 'i-sm' }), ' ', ok ? '校验通过' : `${hints.length} 个提示`)
    }

    function Toast({ toast }) {
      return h('div', { className: `toast is-${toast.kind}` },
        h(Icon, { name: toast.kind === 'error' || toast.kind === 'warn' ? 'alert' : 'check' }),
        h('span', null, toast.message))
    }

    /** 面板折叠状态：按面板名持久化到 localStorage。 */
    function usePanelOpen(name, defaultOpen = true) {
      const [open, setOpen] = useState(() => {
        try {
          const stored = localStorage.getItem('specboard.panel.' + name)
          return stored === null ? defaultOpen : stored === '1'
        } catch {
          return defaultOpen
        }
      })
      const toggle = () => setOpen((value) => {
        const next = !value
        try { localStorage.setItem('specboard.panel.' + name, next ? '1' : '0') } catch {}
        return next
      })
      return [open, toggle]
    }

    function PanelToggle({ open, onToggle, title, path }) {
      return h('button', {
        className: 'cap-toggle',
        'aria-expanded': open,
        onClick: onToggle,
      },
        h(Icon, { name: open ? 'chevron-down' : 'chevron-right', cls: 'i-sm chev' }),
        h('span', { className: 'panel-title' },
          title,
          path ? h('span', { className: 'panel-path mono' }, path) : null))
    }

    function ConflictBar({ onReload, onForce }) {
      return h('div', { className: 'conflict', role: 'alert' },
        h(Icon, { name: 'alert' }),
        h('div', { className: 'conflict-text' },
          h('strong', null, '文件已被 AI 修改'),
          h('p', null, 'proposal.md 在本地编辑期间被写入。请选择重新加载磁盘版本，或强制覆盖。')),
        h('div', { className: 'conflict-actions' },
          h('button', { className: 'btn btn-sm', onClick: onReload }, '重新加载'),
          h('button', { className: 'btn btn-sm btn-danger', onClick: onForce }, '强制覆盖')))
    }

    function Empty({ title, children, actions }) {
      return h('div', { className: 'empty' },
        h('h3', null, title),
        h('p', null, children),
        actions ? h('div', { className: 'empty-actions' }, actions) : null)
    }

    /* ----------------------------------------------------------------- toolbar */

    function ProjectMenu({ projects, current, onSelect, onClose, onDelete }) {
      const ref = useRef(null)
      useEffect(() => {
        const onDoc = (e) => {
          if (ref.current && !ref.current.contains(e.target)) onClose()
        }
        document.addEventListener('mousedown', onDoc)
        return () => document.removeEventListener('mousedown', onDoc)
      }, [onClose])
      return h('div', { className: 'project-menu', ref, role: 'menu' },
        h('div', { className: 'menu-head' }, '切换项目'),
        projects.map((p) => h('div', {
          key: p.root,
          className: `menu-item ${p.root === current ? 'is-current' : ''}`,
          role: 'menuitemradio',
          'aria-checked': p.root === current,
        },
          h('button', { className: 'menu-main', onClick: () => onSelect(p.root) },
            h('span', { className: 'menu-dot' }),
            h('span', { className: 'menu-text' },
              h('span', { className: 'menu-name' }, p.name),
              h('span', { className: 'menu-meta' }, `${p.changeCount} 个需求 · ${p.archivedCount} 个已归档`)),
            p.root === current ? h('span', { className: 'menu-check' }, h(Icon, { name: 'check', cls: 'i-sm' })) : null),
          h('button', {
            className: 'menu-delete',
            title: '删除该项目的 openspec 文档',
            onClick: (e) => {
              e.stopPropagation()
              onDelete(p)
            },
          }, '×'))),
        h('div', { className: 'menu-foot' }, '工作区 · ' + LABELS.adapterLabel))
    }

    function Toolbar({ project, projects, view, theme, syncing, menuOpen, actions }) {
      const dark = theme === 'dark'
      return h('header', { className: 'toolbar' },
        h('div', { className: 'toolbar-inner' },
          h('button', { className: 'brand', onClick: () => actions.setView('list'), 'aria-label': 'SpecBoard · 返回需求列表' },
            h('span', { className: 'brand-mark' }, h(Icon, { name: 'spec' })),
            h('span', { className: 'brand-name' }, 'SpecBoard')),
          h('div', { className: 'project-wrap' },
            h('button', {
              className: `project-btn ${project?.status === 'error' ? 'is-error' : ''}`,
              onClick: actions.toggleMenu,
              'aria-haspopup': true,
              'aria-expanded': menuOpen,
            },
              h(Icon, { name: 'folder', cls: 'i-sm' }),
              h('span', { className: 'project-name' }, project?.name ?? '未识别项目'),
              h('span', { className: 'project-count' }, project ? `· ${project.changes.length} 需求` : ''),
              h(Icon, { name: 'chevron-down', cls: 'i-sm project-chevron' })),
            menuOpen ? h(ProjectMenu, {
              projects,
              current: project?.root,
              onSelect: actions.selectProject,
              onClose: actions.toggleMenu,
              onDelete: actions.requestDelete,
            }) : null),
          h('span', { className: `sync-label ${syncing ? 'is-syncing' : ''}` }, syncing ? '同步中…' : '已同步'),
          h('button', { className: 'icon-btn', onClick: actions.refresh, disabled: syncing, title: '重新读取数据目录', 'aria-label': '刷新项目' },
            h(Icon, { name: 'refresh', cls: syncing ? 'spin' : '' })),
          h('div', { className: 'tb-spacer' }),
          h('div', { className: 'tabs', role: 'tablist' },
            h('button', { className: 'tab', role: 'tab', 'aria-selected': view === 'list', onClick: () => actions.setView('list') },
              h(Icon, { name: 'list', cls: 'i-sm' }), '需求'),
            h('button', { className: 'tab', role: 'tab', 'aria-selected': view === 'graph', onClick: () => actions.setView('graph') },
              h(Icon, { name: 'branch', cls: 'i-sm' }), '任务图')),
          h('div', { className: 'tb-div' }),
          h('button', {
            className: 'icon-btn', onClick: actions.toggleTheme,
            'aria-label': dark ? '切换到浅色主题' : '切换到深色主题',
            title: dark ? '切换到浅色主题' : '切换到深色主题',
          }, h(Icon, { name: dark ? 'sun' : 'moon' }))),
        h('div', { className: `sync-bar ${syncing ? 'is-active' : ''}` }, h('span', null)))
    }

    /* -------------------------------------------------------------------- list */

    function NewForm({ value, error, onChange, onSubmit }) {
      return h('form', {
        className: 'creator',
        onSubmit: (e) => {
          e.preventDefault()
          onSubmit(value)
        },
      },
        h('div', { className: 'creator-row' },
          h('label', { className: `creator-field ${error ? 'is-invalid' : ''}` },
            h(Icon, { name: 'plus', cls: 'i-sm' }),
            h('span', { className: 'sr-only' }, '新需求 id'),
            h('input', {
              value,
              onChange: (e) => onChange(e.target.value),
              placeholder: '新需求 id，例如 add-command-palette',
              autoComplete: 'off',
              spellCheck: false,
              'aria-invalid': Boolean(error),
            })),
          h('button', { className: 'btn btn-primary', type: 'submit' }, '新建需求')),
        h('p', { className: `creator-hint ${error ? 'is-error' : ''}`, role: error ? 'alert' : undefined },
          error || '使用 kebab-case；会创建 proposal / tasks 两个占位文件，其余由 AI 分步生成。'))
    }

    function ChangeRow({ change, archived, onOpen }) {
      const stats = archived ? change.progress ?? { done: 0, total: 0 } : change.progress ?? { done: 0, total: 0 }
      const caps = archived ? 0 : (change.capabilityCount ?? 0)
      const reqs = archived ? 0 : (change.requirementCount ?? 0)
      const inner = [
        h('div', { className: 'req-main', key: 'main' },
          h('div', { className: 'req-title-line' },
            h('span', { className: 'req-title' }, change.title || change.id),
            archived ? h('span', { className: 'chip chip-archived' }, h(Icon, { name: 'lock', cls: 'i-sm' }), ' archived') : null),
          h('div', { className: 'req-sub' },
            h('span', { className: 'req-id mono' }, change.id),
            archived
              ? h('span', { className: 'req-meta' }, '已归档 · 只读')
              : h(React.Fragment, null,
                  h('span', { className: 'sep' }, '·'),
                  h('span', { className: 'req-meta' }, `${caps} 个 capability · ${reqs} 条 requirement`)))),
        h(Artifacts, { key: 'art', art: artifactMap(change.artifacts) }),
        h('div', { className: 'progress-cell', key: 'progress' },
          h('div', { className: 'progress-top' }, h('span', null, '任务'), h('span', { className: 'mono' }, `${stats.done ?? 0}/${stats.total ?? 0}`)),
          h(Progress, { done: stats.done ?? 0, total: stats.total ?? 0 })),
        h('div', { className: `req-open ${archived ? 'is-readonly' : ''}`, key: 'open' },
          archived ? h(React.Fragment, null, h(Icon, { name: 'lock', cls: 'i-sm' }), h('span', null, '只读'))
            : h(React.Fragment, null, h('span', null, '打开'), h(Icon, { name: 'chevron-right', cls: 'i-sm' }))),
      ]
      if (archived) {
        return h('div', {
          className: 'req-row is-archived',
          title: '已归档，只读',
          style: { cursor: onOpen ? 'pointer' : 'default' },
          onClick: onOpen ? () => onOpen(change.id) : undefined,
        }, inner)
      }
      return h('a', {
        className: 'req-row',
        href: `#${change.id}`,
        onClick: (e) => {
          e.preventDefault()
          onOpen(change.id)
        },
        'aria-label': `打开需求 ${change.title || change.id}`,
      }, inner)
    }

    function ListView({ project, busy, actions, ui, setUi }) {
      const archived = project.changes.filter((c) => c.archived)
      const active = project.changes.filter((c) => !c.archived)
      const sub = h(React.Fragment, null,
        h('span', { className: 'mono' }, LABELS.changesDir),
        h('span', { className: 'sep' }, '·'),
        `${active.length} 个进行中`,
        h('span', { className: 'sep' }, '·'),
        `${archived.length} 个已归档`)
      return h('section', { className: 'view wrap-list' },
        h(PageHead, { title: '需求', sub, right: h(Legend, null) }),
        h(NewForm, {
          value: ui.newDraft,
          error: ui.newError,
          onChange: (v) => setUi((s) => ({ ...s, newDraft: v, newError: '' })),
          onSubmit: (v) => actions.createChange(v),
        }),
        active.length
          ? h('div', { className: 'req-list' }, active.map((c) => h(ChangeRow, { key: c.id, change: c, onOpen: actions.openChange })))
          : h(Empty, {
              title: '这个项目还没有需求',
              actions: [
                h('button', { key: 'a', className: 'btn', onClick: () => actions.focusNew() }, '新建需求'),
                h('button', { key: 'b', className: 'btn', onClick: actions.toggleMenu }, '切换项目'),
              ],
            }, '在工具栏切换项目，或在上方输入 kebab-case id 新建一个 change。新建后会出现在这里。'),
        archived.length
          ? h('div', null,
              h('button', { className: 'archived-toggle', 'aria-expanded': ui.showArchived, onClick: () => setUi((s) => ({ ...s, showArchived: !s.showArchived })) },
                h(Icon, { name: ui.showArchived ? 'chevron-down' : 'chevron-right', cls: 'i-sm' }),
                ui.showArchived ? '收起已归档' : `显示已归档（${archived.length}）`),
              ui.showArchived
                ? h('div', { className: 'archived-wrap' },
                    h('div', { className: 'archived-note' }, h(Icon, { name: 'lock', cls: 'i-sm' }), '已归档的 change 只读，不参与任务图统计'),
                    h('div', { className: 'req-list' }, archived.map((c) => h(ChangeRow, { key: c.id, change: c, archived: true, onOpen: actions.openChange }))))
                : null)
          : null)
    }

    /* ------------------------------------------------------------------ detail */

    function Proposal({ change, ui, setUi, actions, readOnly }) {
      const fields = [['why', 'Why', '为什么做', 3], ['changes', 'What Changes', '改动内容', 3], ['impact', 'Impact', '影响范围', 2]]
      const keyOf = (field) => `${change.id}/${field}`
      const conflict = ui.conflict[change.id]
      const [open, togglePanel] = usePanelOpen('proposal')
      return h('section', { className: 'panel' },
        h('div', { className: 'panel-head' },
          h(PanelToggle, { open, onToggle: togglePanel, title: 'Proposal', path: LABELS.files.proposal }),
          h('span', { className: 'panel-hint' }, '三个小节可独立保存')),
        open ? h(React.Fragment, null,
        conflict ? h(ConflictBar, {
          onReload: () => actions.reloadProposal(change.id),
          onForce: () => actions.forceProposal(change.id),
        }) : null,
        h('div', { className: 'panel-body is-flush' },
          fields.map(([field, label, hint, rows]) => {
            const key = keyOf(field)
            const value = ui.drafts[key] !== undefined ? ui.drafts[key] : change.proposal?.[field] ?? ''
            const dirty = Boolean(ui.dirty[key])
            return h('div', { key: field, className: `edit-block ${dirty ? 'is-dirty' : ''}` },
              h('div', { className: 'edit-head' },
                h('div', { className: 'edit-label' }, h('span', { className: 'edit-name' }, label), h('span', { className: 'edit-hint' }, hint)),
                h('div', { className: 'edit-actions' },
                  dirty ? h('span', { className: 'chip chip-amber' }, h(Icon, { name: 'alert', cls: 'i-sm' }), '未保存') : null,
                  readOnly ? null : h('button', {
                    className: 'btn btn-sm btn-save',
                    disabled: !dirty,
                    onClick: () => actions.saveField(change.id, field, value),
                  }, '保存'))),
              h('textarea', {
                className: 'edit-area',
                rows,
                value,
                readOnly,
                'aria-label': label,
                placeholder: '等待 AI 生成，或直接输入…',
                onChange: (e) => setUi((s) => {
                  const next = { ...s, drafts: { ...s.drafts, [key]: e.target.value } }
                  const saved = change.proposal?.[field] ?? ''
                  if (e.target.value === saved) delete next.dirty[key]
                  else next.dirty = { ...s.dirty, [key]: true }
                  return next
                }),
              }))
          }))) : null)
    }

    const OP_CHIP = { ADDED: 'chip-accent', MODIFIED: 'chip-amber', REMOVED: 'chip-archived', RENAMED: 'chip-skip' }
    const OP_LABEL = { ADDED: '新增', MODIFIED: '修改', REMOVED: '删除', RENAMED: '重命名' }

    function Requirement({ req, index }) {
      const op = req.op ?? 'ADDED'
      const removed = op === 'REMOVED'
      const renamed = op === 'RENAMED'
      return h('div', { className: `spec-req ${removed ? 'is-removed' : ''}` },
        h('div', { className: 'spec-head' },
          h('span', { className: 'spec-index mono' }, `${index + 1}.`),
          h('span', { className: 'spec-name' }, req.title),
          h('span', { className: `chip ${OP_CHIP[op] ?? ''}` }, `${op} · ${OP_LABEL[op] ?? ''}`)),
        removed
          ? h('div', { className: 'spec-desc' },
              h('p', null, h('strong', null, 'Reason '), req.reason || '—'),
              h('p', null, h('strong', null, 'Migration '), req.migration || '—'))
          : renamed
            ? h('div', { className: 'spec-desc' },
                h('p', null, h('strong', null, 'FROM '), h('code', null, req.from || '—')),
                h('p', null, h('strong', null, 'TO '), h('code', null, req.to || '—')))
            : h(React.Fragment, null,
                h('p', { className: 'spec-desc' }, req.text),
                h('div', { className: 'scenarios' }, (req.scenarios ?? []).map((sc, i) =>
                  h('div', { className: 'scenario', key: i },
                    h('div', { className: 'scenario-name' }, sc.name),
                    h('div', { className: 'scenario-line' }, h('span', { className: 'kw' }, 'WHEN'), h('span', null, sc.when)),
                    h('div', { className: 'scenario-line' }, h('span', { className: 'kw' }, 'THEN'), h('span', null, sc.then)))))))
    }

    function CapEditor({ cap, onCancel, onSave, busy }) {
      const [purpose, setPurpose] = useState(cap.purpose ?? '')
      const [reqs, setReqs] = useState(() =>
        (cap.requirements ?? []).map((r) => ({ ...r, scenarios: (r.scenarios ?? []).map((s) => ({ ...s })) })))
      const patchReq = (i, patch) => setReqs((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)))
      const patchScenario = (i, k, patch) => setReqs((list) => list.map((r, j) => (
        j !== i ? r : { ...r, scenarios: r.scenarios.map((s, m) => (m === k ? { ...s, ...patch } : s)) })))
      return h('div', { className: 'cap-body' },
        h('label', { className: 'sub-label' }, 'Purpose（新增 capability 时必填，≥50 字符）'),
        h('textarea', {
          className: 'field', rows: 2, value: purpose,
          onChange: (e) => setPurpose(e.target.value),
          placeholder: '这个 capability 是做什么的…',
        }),
        reqs.map((r, i) => h('div', { className: 'req-editor', key: i },
          h('div', { className: 'inline-row' },
            h('span', { className: 'chip' }, r.op ?? 'ADDED'),
            h('input', {
              className: 'field', value: r.title,
              onChange: (e) => patchReq(i, { title: e.target.value }),
              placeholder: 'Requirement 名称',
            }),
            h('button', {
              className: 'btn btn-sm btn-danger',
              onClick: () => setReqs((list) => list.filter((_, j) => j !== i)),
            }, '删除')),
          r.op === 'REMOVED'
            ? h(React.Fragment, null,
                h('label', { className: 'sub-label' }, 'Reason（为什么删）'),
                h('input', {
                  className: 'field', value: r.reason ?? '',
                  onChange: (e) => patchReq(i, { reason: e.target.value }),
                }),
                h('label', { className: 'sub-label' }, 'Migration（迁移方式）'),
                h('input', {
                  className: 'field', value: r.migration ?? '',
                  onChange: (e) => patchReq(i, { migration: e.target.value }),
                }))
            : r.op === 'RENAMED'
              ? h(React.Fragment, null,
                  h('label', { className: 'sub-label' }, 'FROM（旧名称）'),
                  h('input', {
                    className: 'field', value: r.from ?? '',
                    onChange: (e) => patchReq(i, { from: e.target.value }),
                  }),
                  h('label', { className: 'sub-label' }, 'TO（新名称）'),
                  h('input', {
                    className: 'field', value: r.to ?? '',
                    onChange: (e) => patchReq(i, { to: e.target.value }),
                  }))
              : h(React.Fragment, null,
                  h('label', { className: 'sub-label' }, '描述（一句话，≤500 字符）'),
                  h('textarea', {
                    className: 'field', rows: 2, value: r.text,
                    onChange: (e) => patchReq(i, { text: e.target.value }),
                    placeholder: '系统 SHALL …',
                  }),
                  (r.scenarios ?? []).map((s, k) => h('div', { className: 'scenario-editor', key: k },
                    h('div', { className: 'inline-row' },
                      h('input', {
                        className: 'field', value: s.name,
                        onChange: (e) => patchScenario(i, k, { name: e.target.value }),
                        placeholder: 'Scenario 名称',
                      }),
                      h('button', {
                        className: 'btn btn-sm',
                        onClick: () => setReqs((list) => list.map((x, j) => j !== i ? x : { ...x, scenarios: x.scenarios.filter((_, m) => m !== k) })),
                      }, '删除场景')),
                    h('label', { className: 'sub-label' }, 'WHEN'),
                    h('input', {
                      className: 'field', value: s.when,
                      onChange: (e) => patchScenario(i, k, { when: e.target.value }),
                    }),
                    h('label', { className: 'sub-label' }, 'THEN'),
                    h('input', {
                      className: 'field', value: s.then,
                      onChange: (e) => patchScenario(i, k, { then: e.target.value }),
                    }))),
                  h('button', {
                    className: 'btn btn-sm',
                    onClick: () => setReqs((list) => list.map((x, j) => (
                      j !== i ? x : { ...x, scenarios: [...(x.scenarios ?? []), { name: `场景 ${(x.scenarios?.length ?? 0) + 1}`, when: '', then: '' }] }))),
                  }, '+ 场景')))),
        h('div', { className: 'editor-actions' },
          h('button', {
            className: 'btn btn-sm',
            onClick: () => setReqs((list) => [...list, {
              op: 'ADDED', title: `新需求 ${list.length + 1}`, text: '',
              scenarios: [{ name: '场景 1', when: '', then: '' }],
            }]),
          }, '+ Requirement'),
          h('button', { className: 'btn', onClick: onCancel }, '取消'),
          h('button', {
            className: 'btn btn-primary',
            disabled: busy,
            onClick: () => onSave({
              purpose,
              requirements: reqs.map((r) => ({
                op: r.op ?? 'ADDED',
                name: r.title,
                description: r.text,
                reason: r.reason ?? '',
                migration: r.migration ?? '',
                from: r.from ?? '',
                to: r.to ?? '',
                scenarios: r.scenarios ?? [],
              })),
            }),
          }, busy ? '保存中…' : '保存')))
    }

    function Capabilities({ change, caps, ui, setUi, actions, readOnly }) {
      const [editing, setEditing] = useState(null)
      const [panelOpen, togglePanel] = usePanelOpen('capabilities')
      return h('section', { className: 'panel' },
        h('div', { className: 'panel-head' },
          h(PanelToggle, { open: panelOpen, onToggle: togglePanel, title: 'Capabilities', path: LABELS.specsDir }),
          h('span', { className: 'panel-hint' }, `${caps.length} 个 capability`)),
        panelOpen ? h('div', { className: 'panel-body' },
          caps.length
            ? caps.map((cap) => {
                const open = ui.caps[cap.id] !== false
                return h('article', { className: 'cap', key: cap.id },
                  h('div', { className: 'cap-head' },
                    h('button', {
                      className: 'cap-toggle',
                      'aria-expanded': open,
                      onClick: () => setUi((s) => ({ ...s, caps: { ...s.caps, [cap.id]: !open } })),
                    },
                      h(Icon, { name: open ? 'chevron-down' : 'chevron-right', cls: 'i-sm chev' }),
                      h('span', { className: 'cap-name' }, cap.id),
                      h('span', { className: `chip ${cap.kind === 'added' ? 'chip-accent' : ''}` }, cap.kind === 'added' ? '新增' : '修改'),
                      h('span', { className: 'cap-meta' }, `${cap.requirements.length} 条 requirement`)),
                    open && editing !== cap.id && !readOnly
                      ? h('button', { className: 'btn btn-sm', onClick: () => setEditing(cap.id) }, '编辑')
                      : null),
                  open
                    ? h(React.Fragment, null,
                        editing === cap.id
                          ? h(CapEditor, {
                              cap,
                              busy: false,
                              onCancel: () => setEditing(null),
                              onSave: async (delta) => {
                                const ok = await actions.saveDelta(change.id, cap.id, delta, cap.hash, cap.kind === 'added')
                                if (ok) setEditing(null)
                              },
                            })
                          : h('div', { className: 'cap-body' }, cap.requirements.map((r, i) => h(Requirement, { key: i, req: r, index: i }))),
                        !editing && cap.main?.length
                          ? h('details', { className: 'main-spec' },
                              h('summary', null, `当前主 spec · ${cap.main.length} 条 requirement（只读）`),
                              h('ul', null, cap.main.map((r, i) => h('li', { key: i }, r.name, ' · ', `${r.scenarios} scenario`))))
                          : null)
                    : null)
              })
            : h('div', { className: 'inline-empty' }, '还没有 capability。', h('span', null, '生成 specs 后，capability 与 requirement 会出现在这里。')))
          : null)
    }

    function DesignEditor({ change, onCancel, onSave, busy }) {
      const raw = change.design?.raw ?? {}
      const [draft, setDraft] = useState({
        context: raw.context ?? '',
        goals: raw.goals ?? '',
        decisions: raw.decisions ?? '',
        risks: raw.risks ?? '',
      })
      const fields = [
        ['context', 'Context'],
        ['goals', 'Goals / Non-Goals'],
        ['decisions', 'Decisions'],
        ['risks', 'Risks / Trade-offs'],
      ]
      return h('div', { className: 'panel-body' },
        fields.map(([key, label]) => h('div', { key, className: 'edit-block' },
          h('label', { className: 'sub-label' }, label),
          h('textarea', {
            className: 'field',
            rows: key === 'context' ? 3 : 4,
            value: draft[key],
            onChange: (e) => setDraft((d) => ({ ...d, [key]: e.target.value })),
          }))),
        h('div', { className: 'editor-actions' },
          h('button', { className: 'btn', onClick: onCancel }, '取消'),
          h('button', {
            className: 'btn btn-primary',
            disabled: busy,
            onClick: () => onSave(draft),
          }, busy ? '保存中…' : '保存 design')))
    }

    function Design({ change, ui, setUi, actions, readOnly }) {
      const open = ui.designOpen[change.id] !== false
      const [editing, setEditing] = useState(false)
      const d = change.design?.sections
      return h('section', { className: 'panel' },
        h('div', { className: 'panel-head panel-toggle' },
          h('button', {
            className: 'cap-toggle',
            'aria-expanded': open,
            onClick: () => setUi((s) => ({ ...s, designOpen: { ...s.designOpen, [change.id]: !open } })),
          },
            h(Icon, { name: open ? 'chevron-down' : 'chevron-right', cls: 'i-sm chev' }),
            h('span', { className: 'panel-title' },
              'Design ',
              h('span', { className: 'panel-path mono' }, LABELS.files.design),
              h('span', { className: 'chip chip-skip' }, '可跳过'))),
          h('span', { className: 'panel-hint' }, d ? '4 个小节' : '待生成'),
          d && open && !editing && !readOnly ? h('button', { className: 'btn btn-sm', onClick: () => setEditing(true) }, '编辑') : null),
        open
          ? editing
            ? h(DesignEditor, {
                change,
                busy: false,
                onCancel: () => setEditing(false),
                onSave: async (draft) => {
                  const ok = await actions.saveDesign(change.id, draft)
                  if (ok) setEditing(false)
                },
              })
            : h('div', { className: 'panel-body' },
                d
                  ? h(React.Fragment, null,
                      change.tech?.exists
                        ? h('p', { className: 'sb-small sb-muted', style: { margin: '0 0 9px' } },
                            '技术决策、数据模型、接口与目录结构都在 tech/ 下；这里只保留背景与目标。')
                        : null,
                      h('div', { className: 'design-grid' },
                      h('div', { className: 'design-sec' }, h('h4', null, 'Context'), h('p', null, d.context)),
                      h('div', { className: 'design-sec' }, h('h4', null, 'Goals / NonGoals'),
                        h('p', null, h('strong', null, '目标 '), d.goals),
                        h('p', null, h('strong', null, '非目标 '), d.nonGoals)),
                      h('div', { className: 'design-sec' }, h('h4', null, 'Decisions'),
                        h('ul', null, (d.decisions ?? []).map((x, i) =>
                          h('li', { key: i }, x.lead, h('code', null, x.code), x.tail))),
                        h('h4', null, 'Risks'),
                        h('p', null, d.risks)),
                      h('div', { className: 'design-sec' }, h('h4', null, 'Migration'), h('p', null, d.migration || '—'))))
                  : h('div', { className: 'design-empty' },
                      h('p', null, 'design.md 尚未生成。design 可以跳过，不影响 proposal 与 specs 的校验。'),
                      h('button', { className: 'btn btn-sm', onClick: () => actions.hintDesign() }, '如何生成')))
          : null)
    }

    function TaskRow({ group, task, scope, missing, onToggle }) {
      const deps = task.depends ?? []
      return h('div', { className: `task-row ${task.done ? 'is-complete' : ''}` },
        h('button', {
          className: 'check',
          role: 'checkbox',
          'aria-checked': task.done,
          'aria-label': `${task.done ? '标记为未完成' : '标记为已完成'}：${task.title}`,
          onClick: () => onToggle(scope, group.index, task),
        }, h(Icon, { name: 'check', cls: 'i-sm' })),
        h('span', { className: 'task-num mono' }, task.num),
        h('span', { className: 'task-desc' }, task.title),
        deps.length
          ? h('span', { className: 'task-deps' }, deps.map((d) =>
              h('span', { key: d, className: `dep ${missing.has(d) ? 'is-missing' : ''}`, title: missing.has(d) ? '依赖的任务不存在' : `依赖 ${d}` }, `depends: ${d}`)))
          : null,
        (task.files?.length || task.contracts?.length || task.entities?.length || task.tests?.length)
          ? h('span', { className: 'task-deps' },
              (task.tests ?? []).map((f) => h('span', { key: `t:${f}`, className: 'dep', title: '测试先行' }, `test: ${f}`)),
              (task.files ?? []).map((f) => h('span', { key: `f:${f}`, className: 'dep', title: '允许写入的文件' }, `file: ${f}`)),
              (task.contracts ?? []).map((c) => h('span', { key: `c:${c}`, className: 'dep', title: '引用的接口契约' }, `contract: ${c}`)),
              (task.entities ?? []).map((e) => h('span', { key: `e:${e}`, className: 'dep', title: '引用的数据实体' }, `entity: ${e}`)))
          : null)
    }

    function TaskGroup({ group, scope, allNums, onToggle, onAdd, onDelete, readOnly }) {
      const stats = statsOf([group])
      const [open, setOpen] = useState(true)
      const missing = new Set((group.tasks ?? []).flatMap((t) => (t.depends ?? []).filter((d) => !allNums.has(d))))
      return h('div', { className: 'task-group' },
        h('div', { className: 'task-group-head' },
          h('button', {
            className: 'cap-toggle group-toggle',
            'aria-expanded': open,
            onClick: () => setOpen((v) => !v),
          },
            h(Icon, { name: open ? 'chevron-down' : 'chevron-right', cls: 'i-sm chev' }),
            h('span', { className: 'group-num mono' }, `${group.index}.`),
            h('span', { className: 'cap-bracket mono' }, `[${group.cap}]`),
            h('span', { className: 'group-title' }, group.title)),
          h('span', { className: 'group-count mono' }, `${stats.done}/${stats.total}`),
          onDelete ? h('button', {
            className: 'btn btn-sm btn-danger',
            title: '删除整个任务组（含任务）',
            onClick: () => onDelete(group.index),
          }, '删除组') : null),
        open ? (group.tasks ?? []).map((t) => h(TaskRow, { key: t.num, group, task: t, scope, missing, onToggle })) : null,
        open && !readOnly ? h('div', { className: 'add-task' },
          h(Icon, { name: 'plus', cls: 'i-sm' }),
          h('input', {
            placeholder: '新增任务，回车保存',
            'aria-label': `在 ${group.title} 中新增任务`,
            onKeyDown: (e) => {
              if (e.key === 'Enter' && !e.isComposing && e.target.value.trim()) {
                e.preventDefault()
                onAdd(scope, group.index, e.target.value.trim())
                e.target.value = ''
              }
            },
          }),
          h('span', { className: 'kbd' }, 'Enter')) : null)
    }

    function Tasks({ change, groups, onToggle, onAdd, readOnly }) {
      const stats = statsOf(groups)
      const nums = new Set(groups.flatMap((g) => g.tasks.map((t) => t.num)))
      const [open, togglePanel] = usePanelOpen('tasks', false)
      return h('section', { className: 'panel' },
        h('div', { className: 'panel-head' },
          h(PanelToggle, { open, onToggle: togglePanel, title: 'Tasks', path: LABELS.files.tasks }),
          h('div', { className: 'head-progress' },
            h('span', { className: 'mono' }, `${stats.done}/${stats.total}`),
            h(Progress, { done: stats.done, total: stats.total }))),
        open ? h('div', { className: 'panel-body' },
          groups.length
            ? groups.map((g) => h(TaskGroup, {
                key: g.index,
                group: g,
                scope: 'tasks',
                allNums: nums,
                onToggle,
                onAdd,
                readOnly,
              }))
            : h('div', { className: 'inline-empty' }, '还没有任务。', h('span', null, 'tasks.md 生成后，任务会按组出现在这里。'))) : null)
    }

    function GlobalTasks({ groups, onToggle, onAdd, onAddGroup, onDeleteGroup }) {
      const [adding, setAdding] = useState(false)
      const [title, setTitle] = useState('')
      const [open, togglePanel] = usePanelOpen('globalTasks', false)
      const stats = statsOf(groups)
      const nums = new Set(groups.flatMap((g) => g.tasks.map((t) => t.num)))
      return h('section', { className: 'panel' },
        h('div', { className: 'panel-head' },
          h(PanelToggle, { open, onToggle: togglePanel, title: '全局任务', path: LABELS.globalTasksFile }),
          h('div', { className: 'head-meta' },
            h('span', { className: 'chip chip-skip' }, '不计入本需求进度'),
            h('span', { className: 'head-count mono' }, `${stats.done}/${stats.total}`),
            h('button', { className: 'btn btn-sm', onClick: () => setAdding((v) => !v) }, '+ 任务组'))),
        open ? h(React.Fragment, null,
        adding ? h('div', { className: 'inline-row', style: { padding: '8px 12px', gap: 8 } },
          h('input', {
            className: 'field',
            placeholder: '新任务组标题，例如 工程基础',
            value: title,
            onChange: (e) => setTitle(e.target.value),
          }),
          h('button', {
            className: 'btn btn-primary',
            disabled: !title.trim(),
            onClick: () => {
              onAddGroup('global', title.trim())
              setTitle('')
              setAdding(false)
            },
          }, '添加')) : null,
        h('div', { className: 'panel-body' },
          groups.length
            ? groups.map((g) => h(TaskGroup, {
                key: g.index,
                group: g,
                scope: 'global',
                allNums: nums,
                onToggle,
                onAdd,
                onDelete: onDeleteGroup,
                readOnly: false,
              }))
            : h('div', { className: 'inline-empty' }, '尚未配置全局任务。', h('span', null, '新建一个任务组，会写入 ' + LABELS.globalTasksFile + '。'))))
          : null)
    }

    const TECH_FILES = [
      ['research', 'research.md', '选型与替代方案'],
      ['dataModel', 'data-model.md', '实体 / 字段 / 索引'],
      ['contracts', 'contracts/', '接口契约'],
      ['structure', 'structure.md', '目录与依赖方向'],
      ['seams', 'seams.md', '测试接缝'],
      ['coverage', 'coverage.md', '覆盖表（G1）'],
    ]

    function TechPanel({ change }) {
      const [open, togglePanel] = usePanelOpen('tech')
      const tech = change.tech
      const gates = change.gates
      const gateIssues = (change.issues ?? []).filter((i) => i.gate && i.gate.startsWith('G'))
      const exists = Boolean(tech?.exists)
      return h('section', { className: 'panel' },
        h('div', { className: 'panel-head panel-toggle' },
          h('button', {
            className: 'cap-toggle',
            'aria-expanded': open,
            onClick: togglePanel,
          },
            h(Icon, { name: open ? 'chevron-down' : 'chevron-right', cls: 'i-sm chev' }),
            h('span', { className: 'panel-title' },
              '技术设计 ',
              h('span', { className: 'panel-path mono' }, 'tech/'),
              tech?.skipped ? h('span', { className: 'chip chip-skip' }, 'tech-skip') : null)),
          h('span', { className: 'panel-hint' },
            exists ? (gates?.ready ? '门禁通过' : `${gateIssues.length} 个门禁问题`) : '待生成')),
        open
          ? h('div', { className: 'panel-body' },
              !exists
                ? h('div', { className: 'inline-empty' },
                    '还没有 tech/ 目录。',
                    h('span', null, '运行 tech-grill 后会生成 research / data-model / contracts / structure / seams / coverage。'))
                : h(React.Fragment, null,
                    h('div', { className: 'design-grid' },
                      TECH_FILES.map(([key, file, hint]) => {
                        const present = key === 'contracts' ? (tech.files?.contracts ?? 0) > 0 : Boolean(tech.files?.[key])
                        return h('div', { className: 'design-sec', key },
                          h('h4', null,
                            h('span', { className: 'mono' }, file),
                            ' ',
                            h('span', { className: `chip ${present ? 'chip-accent' : ''}` }, present ? '有' : '缺')),
                          h('p', null, hint))
                      })),
                    tech.coverage?.domains?.length
                      ? h('div', { className: 'design-sec' },
                          h('h4', null, '领域覆盖'),
                          h('ul', null, tech.coverage.domains.map((row, i) =>
                            h('li', { key: i },
                              h('span', { className: 'mono' }, row.domain || '—'),
                              ' · ',
                              row.status || '—',
                              row.evidence ? h('span', { className: 'sb-small sb-muted' }, ' — ' + row.evidence) : null))))
                      : null,
                    gateIssues.length
                      ? h('div', { className: 'notice', role: 'status' },
                          h(Icon, { name: 'alert' }),
                          h('div', { className: 'notice-body' },
                            h('strong', null, `${gateIssues.length} 个门禁问题`),
                            h('span', { className: 'notice-list' },
                              gateIssues.slice(0, 8).map((i) => `${i.gate} · ${i.message}`).join('；'))))
                      : h('div', { className: 'inline-empty' },
                          h('span', null, gates?.ready ? 'G1 / G2 全部通过，可以生成或执行任务。' : '门禁状态未知。'))))
          : null)
    }

    function TreeNode({ node }) {
      return h('li', null,
        h('span', { className: 'mono' }, node.name),
        node.children?.length
          ? h('ul', null, node.children.map((child, i) => h(TreeNode, { key: i, node: child })))
          : null)
    }

    function ApprovalChip({ approval }) {
      if (!approval) return null
      if (approval.approved) return h('span', { className: 'chip chip-accent' }, '已确认')
      if (approval.stale) return h('span', { className: 'chip chip-amber' }, '确认后已修改')
      return h('span', { className: 'chip' }, '待确认')
    }

    function StructurePanel({ change, actions }) {
      const tech = change.tech
      const [open, togglePanel] = usePanelOpen('structure')
      if (!tech?.files?.structure) return null
      const approval = tech.approvals?.structure
      const readOnly = change.archived
      return h('section', { className: 'panel' },
        h('div', { className: 'panel-head' },
          h(PanelToggle, { open, onToggle: togglePanel, title: '工程结构', path: 'tech/structure.md' }),
          h('div', { className: 'head-meta' },
            h(ApprovalChip, { approval }),
            readOnly || approval?.approved
              ? null
              : h('button', {
                  className: 'btn btn-sm btn-primary',
                  onClick: () => actions.approveTech(change.id, 'structure'),
                }, '确认结构'))),
        open ? h('div', { className: 'panel-body' },
          tech.structureTree
            ? h('ul', { className: 'sb-tree' }, tech.structureTree.children.map((child, i) => h(TreeNode, { key: i, node: child })))
            : h('div', { className: 'inline-empty' }, 'structure.md 里没有可解析的目录树代码块。'),
          h('p', { className: 'sb-small sb-muted', style: { marginTop: 10 } },
            '确认后，任何对 structure.md 的修改都会让确认失效，需要重新确认。')) : null)
    }

    function ErDiagram({ model }) {
      if (!model?.entities?.length) return null
      const entities = model.entities
      const GAPX = 80
      const GAPY = 44
      const HEAD = 30
      const ROW = 18
      const PAD = 10
      const charWidth = (ch) => (ch.charCodeAt(0) > 255 ? 10.5 : 6.2)
      const measure = (text) => [...String(text)].reduce((sum, ch) => sum + charWidth(ch), 0)
      const fit = (text, max) => {
        let width = 0
        let out = ''
        for (const ch of String(text)) {
          const w = charWidth(ch)
          if (width + w > max) return `${out}…`
          width += w
          out += ch
        }
        return out
      }
      const fieldLine = (field) => `${field.name}: ${field.type || '?'}${field.index ? ' · ' + field.index : ''}`
      const longest = Math.max(200, ...entities.flatMap((e) => e.fields.map((f) => measure(fieldLine(f)) + 24)))
      const W = Math.min(320, longest)
      const boxH = (entity) => HEAD + Math.max(1, entity.fields.length) * ROW + PAD
      const rowH = Math.max(...entities.map(boxH))
      const cols = Math.min(3, entities.length)
      const rows = Math.ceil(entities.length / cols)
      const width = cols * W + (cols - 1) * GAPX + 40
      const height = rows * rowH + (rows - 1) * GAPY + 40
      const pos = new Map()
      entities.forEach((entity, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        pos.set(entity.name, { x: 20 + col * (W + GAPX), y: 20 + row * (rowH + GAPY), h: boxH(entity) })
      })
      const edges = (model.relations ?? []).map((rel) => {
        const from = pos.get(rel.from)
        const to = pos.get(rel.to)
        if (!from || !to) return null
        const forward = to.x >= from.x
        const x1 = forward ? from.x + W : from.x
        const y1 = from.y + from.h / 2
        const x2 = forward ? to.x : to.x + W
        const y2 = to.y + to.h / 2
        const dx = Math.max(36, Math.abs(x2 - x1) / 2)
        const c1 = forward ? x1 + dx : x1 - dx
        const c2 = forward ? x2 - dx : x2 + dx
        return {
          ...rel,
          key: `${rel.from}->${rel.to}`,
          d: `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`,
          mx: (x1 + x2) / 2,
          my: (y1 + y2) / 2 - 5,
          x1, y1, x2, y2,
        }
      }).filter(Boolean)
      return h('svg', {
        className: 'sb-er',
        viewBox: `0 0 ${width} ${height}`,
        style: { width: '100%', maxWidth: `${width}px`, height: 'auto' },
        role: 'img',
        'aria-label': '数据模型 ER 图',
      },
        h('defs', null,
          h('marker', { id: 'sb-er-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto' },
            h('path', { d: 'M0,0 L8,4 L0,8 Z', fill: 'currentColor', opacity: 0.55 }))),
        edges.map((edge) => h('g', { key: edge.key },
          h('path', {
            d: edge.d,
            fill: 'none',
            stroke: 'currentColor',
            opacity: edge.inferred ? 0.35 : 0.55,
            strokeWidth: 1.2,
            strokeDasharray: edge.inferred ? '4 3' : undefined,
            markerEnd: 'url(#sb-er-arrow)',
          }),
          h('circle', { cx: edge.x1, cy: edge.y1, r: 2.5, fill: 'currentColor', opacity: 0.5 }),
          h('circle', { cx: edge.x2, cy: edge.y2, r: 2.5, fill: 'currentColor', opacity: 0.5 }),
          h('text', {
            x: edge.mx,
            y: edge.my,
            fontSize: 10,
            textAnchor: 'middle',
            fill: 'currentColor',
            opacity: 0.7,
          }, edge.type || '1..n'))),
        entities.map((entity) => {
          const p = pos.get(entity.name)
          return h('g', { key: entity.name },
            h('rect', {
              x: p.x, y: p.y, width: W, height: p.h, rx: 8,
              fill: 'var(--surface)', stroke: 'var(--border-strong)', strokeWidth: 1,
            }),
            h('rect', { x: p.x, y: p.y, width: W, height: HEAD, rx: 8, fill: 'var(--surface-2)' }),
            h('text', { x: p.x + PAD, y: p.y + 19, fontSize: 12, fontWeight: 600, fill: 'currentColor' }, fit(entity.name, W - PAD * 2)),
            entity.fields.map((field, j) => h('text', {
              key: j,
              x: p.x + PAD,
              y: p.y + HEAD + 13 + j * ROW,
              fontSize: 10.5,
              fill: 'currentColor',
              opacity: 0.85,
            }, fit(fieldLine(field), W - PAD * 2))))
        }))
    }

    function DataModelPanel({ change, actions }) {
      const tech = change.tech
      const [open, togglePanel] = usePanelOpen('dataModel')
      if (!tech?.files?.dataModel) return null
      const approval = tech.approvals?.dataModel
      const model = tech.dataModelModel
      const readOnly = change.archived
      return h('section', { className: 'panel' },
        h('div', { className: 'panel-head' },
          h(PanelToggle, { open, onToggle: togglePanel, title: '数据模型', path: 'tech/data-model.md' }),
          h('div', { className: 'head-meta' },
            h(ApprovalChip, { approval }),
            readOnly || approval?.approved
              ? null
              : h('button', {
                  className: 'btn btn-sm btn-primary',
                  onClick: () => actions.approveTech(change.id, 'dataModel'),
                }, '确认数据模型'))),
        open ? h('div', { className: 'panel-body' },
          model?.entities?.length
            ? h('div', { style: { overflowX: 'auto' } }, h(ErDiagram, { model }))
            : h('div', { className: 'inline-empty' }, 'data-model.md 里没有解析到实体表。'),
          model?.entities?.length > 1 && !(model.relations?.length)
            ? h('p', { className: 'sb-small sb-muted' },
                '未解析到关系：在 data-model.md 增加 ## Relations 表（From/To/Type/On），或使用形如 category_id 的外键字段。')
            : null,
          h('p', { className: 'sb-small sb-muted', style: { marginTop: 10 } },
            '确认后，任何对 data-model.md 的修改都会让确认失效，需要重新确认。')) : null)
    }

    function GrillPanel({ change, actions }) {
      const [open, togglePanel] = usePanelOpen('grill')
      const grill = change.grill
      const cards = [
        ['requirement', '需求 grill', 'grill/requirement.md', 'requirementGrill', '写 proposal 之前完成'],
        ['tech', '技术 grill', 'grill/tech.md', 'techGrill', '写 tech/ 之前完成'],
      ]
      const approvedCount = cards.filter(([key]) => grill?.approvals?.[key]?.approved).length
      return h('section', { className: 'panel' },
        h('div', { className: 'panel-head' },
          h(PanelToggle, { open, onToggle: togglePanel, title: 'Grill 记录', path: 'grill/' }),
          h('div', { className: 'head-meta' },
            h('span', { className: `chip ${approvedCount === 2 ? 'chip-accent' : ''}` }, `${approvedCount}/2 已确认`))),
        open ? h('div', { className: 'panel-body' },
          cards.map(([key, label, path, kind, hint]) => {
            const approval = grill?.approvals?.[key]
            const text = grill?.[key] ?? ''
            return h('div', { className: 'edit-block', key },
              h('div', { className: 'edit-head' },
                h('div', { className: 'edit-label' },
                  h('span', { className: 'edit-name' }, label),
                  h('span', { className: 'edit-hint' }, `${hint} · ${path}`)),
                h('div', { className: 'edit-actions' },
                  h(ApprovalChip, { approval }),
                  change.archived || approval?.approved
                    ? null
                    : h('button', {
                        className: 'btn btn-sm btn-primary',
                        disabled: !text.trim(),
                        onClick: () => actions.approveTech(change.id, kind),
                      }, '确认'))),
              text.trim()
                ? h('pre', { className: 'grill-preview' }, text)
                : h('div', { className: 'inline-empty' }, '尚未生成，先完成对应的 grill 对话。'))
          })) : null)
    }

    function DetailView({ project, change, ui, setUi, actions }) {
      const caps = capsOf(change)
      const groups = groupsOf(change.taskGroups)
      const globalGroups = groupsOf(project.globalTasks?.groups)
      const stats = statsOf(groups)
      const reqs = reqCount(caps)
      return h('section', { className: 'view wrap-detail' },
        h('nav', { className: 'breadcrumb', 'aria-label': '面包屑' },
          h('button', { onClick: () => actions.setView('list') }, h(Icon, { name: 'arrow-left', cls: 'i-sm' }), '全部需求'),
          h('span', { className: 'crumb-sep' }, '/'),
          h('span', { className: 'crumb-current' }, change.title || change.id)),
        h('header', { className: 'detail-head' },
          h('div', { className: 'detail-top' },
            h('div', { className: 'detail-title-wrap' },
              h('div', { className: 'detail-title-row' },
                h('h1', { className: 'detail-title' }, change.title || change.id),
                h('span', { className: 'detail-id mono' }, change.id)),
              h('div', { className: 'detail-facts' },
                h('span', { className: 'mono' }, `${LABELS.changesDir}/${change.id}`),
                h('span', { className: 'sep' }, '·'),
                h('span', null, `${caps.length} 个 capability`),
                h('span', { className: 'sep' }, '·'),
                h('span', null, `${reqs} 条 requirement`))),
            h(Badge, { change, onClick: () => actions.showValidation(change) }),
            change.gates
              ? h('span', {
                  className: `badge ${change.gates.ready ? 'badge-ok' : 'badge-warn'}`,
                  title: (change.issues ?? []).filter((i) => i.gate).map((i) => `${i.gate}: ${i.message}`).join('\n') || '技术门禁通过',
                },
                  h(Icon, { name: change.gates.ready ? 'check-circle' : 'alert', cls: 'i-sm' }),
                  ' ',
                  change.gates.ready ? '实现就绪' : '门禁未过')
              : null),
          h('div', { className: 'summary' },
            h('div', { className: 'summary-block' },
              h('span', { className: 'summary-label' }, '产物'),
              h(Artifacts, { art: artifactMap(change.artifacts), large: true })),
            h('div', { className: 'summary-block' },
              h('span', { className: 'summary-label' }, '任务进度'),
              h('div', { className: 'summary-progress-row' },
                h('span', { className: 'mono summary-count' }, `${stats.done}/${stats.total}`),
                h(Progress, { done: stats.done, total: stats.total }))),
            h('div', { className: 'summary-block' },
              h('span', { className: 'summary-label' }, '范围'),
              h('span', { className: 'summary-scope' }, `${reqs} requirement `, h('span', { className: 'sep' }, '·'), ` ${scenarioCount(caps)} scenario`)))),
        change.archived ? h('div', { className: 'archived-note' }, h(Icon, { name: 'lock', cls: 'i-sm' }), '该 change 已归档：内容只读') : null,
        h(GrillPanel, { change, actions }),
        change.proposal ? h(Proposal, { change, ui, setUi, actions, readOnly: change.archived }) : null,
        h(Capabilities, { change, caps, ui, setUi, actions, readOnly: change.archived }),
        h(Design, { change, ui, setUi, actions, readOnly: change.archived }),
        h(TechPanel, { change }),
        h(StructurePanel, { change, actions }),
        h(DataModelPanel, { change, actions }),
        h(Tasks, {
          change,
          groups,
          onToggle: actions.toggleTask,
          onAdd: actions.addTask,
          readOnly: change.archived,
        }),
        h(GlobalTasks, {
          groups: globalGroups,
          onToggle: actions.toggleTask,
          onAdd: actions.addTask,
          onAddGroup: actions.addGroup,
          onDeleteGroup: actions.deleteGroup,
        }))
    }

    /* ------------------------------------------------------------------- graph */

    const NW = 190
    const NH = 54
    const LH = 94
    const GAP = 56
    const PAD = 24

    function graphModel(project) {
      const lanes = []
      const byOwner = new Map()
      const push = (owner, ownerLabel, scope, changeId, group) => {
        lanes.push({ owner, ownerLabel, scope, changeId, group, tasks: group.tasks.map((t) => ({ ...t, owner, scope })) })
      }
      for (const c of project.changes.filter((x) => !x.archived)) {
        const tasks = (project.allTasks ?? []).filter((t) => t.changeId === c.id)
        const grouped = new Map()
        for (const t of tasks) {
          if (!grouped.has(t.group)) grouped.set(t.group, { index: Number(t.group), cap: t.capability ?? 'global', title: t.groupTitle, tasks: [] })
          grouped.get(t.group).tasks.push(t)
        }
        for (const g of [...grouped.values()].sort((a, b) => a.index - b.index)) {
          push(c.id, c.title || c.id, 'change', c.id, {
            index: g.index,
            cap: g.cap,
            title: g.title,
            tasks: g.tasks.map((t) => ({ num: t.id, title: t.text, done: t.done, depends: t.depends ?? [] })),
          })
        }
      }
      const globals = new Map()
      for (const t of (project.allTasks ?? []).filter((t) => t.file === 'global')) {
        if (!globals.has(t.group)) globals.set(t.group, { index: Number(t.group), cap: t.capability ?? 'global', title: t.groupTitle, tasks: [] })
        globals.get(t.group).tasks.push(t)
      }
      for (const g of [...globals.values()].sort((a, b) => a.index - b.index)) {
        push('global', '全局任务', 'global', null, {
          index: g.index,
          cap: g.cap,
          title: g.title,
          tasks: g.tasks.map((t) => ({ num: t.id, title: t.text, done: t.done, depends: t.depends ?? [] })),
        })
      }
      for (const lane of lanes) {
        if (!byOwner.has(lane.owner)) byOwner.set(lane.owner, new Map())
        for (const t of lane.tasks) byOwner.get(lane.owner).set(t.num, t)
      }
      const cols = new Map()
      const colOf = (owner, task, seen = new Set()) => {
        const key = `${owner}:${task.num}`
        if (cols.has(key)) return cols.get(key)
        if (seen.has(key)) return 0
        seen.add(key)
        let col = 0
        for (const dep of task.depends ?? []) {
          const target = byOwner.get(owner)?.get(dep)
          if (target) col = Math.max(col, colOf(owner, target, seen) + 1)
        }
        cols.set(key, col)
        return col
      }
      for (const lane of lanes) for (const t of lane.tasks) t.col = colOf(lane.owner, t)

      const missing = []
      for (const lane of lanes) for (const t of lane.tasks) {
        for (const dep of t.depends ?? []) {
          if (!byOwner.get(lane.owner)?.has(dep)) missing.push({ lane, task: t, dep })
        }
      }
      return { lanes, byOwner, missing }
    }

    function GraphView({ project, ui, setUi, actions }) {
      const { lanes, byOwner, missing } = useMemo(() => graphModel(project), [project])
      const total = lanes.reduce((n, l) => n + l.tasks.length, 0)
      const doneCount = lanes.reduce((n, l) => n + l.tasks.filter((t) => t.done).length, 0)
      const filter = ui.graph
      const visibleLane = (l) => filter.change === 'all' || l.owner === filter.change
      const visibleTask = (t, l) => visibleLane(l) && (filter.mode === 'all' || !t.done)
      const shown = lanes.filter(visibleLane)
      const visibleCount = shown.reduce((n, l) => n + l.tasks.filter((t) => visibleTask(t, l)).length, 0)

      if (!total) {
        return h('section', { className: 'view wrap-graph' },
          h(PageHead, { title: '任务图', sub: `${project.changes.length} 个 change · 0 个任务` }),
          h(Empty, {
            title: '还没有任务',
            actions: [
              h('button', { key: 'a', className: 'btn', onClick: () => actions.setView('list') }, '去需求列表'),
              h('button', { key: 'b', className: 'btn', onClick: actions.toggleMenu }, '切换项目'),
            ],
          }, '任务图会汇总所有 change 与全局任务。先在需求中生成 tasks.md，或切换到其它项目。'))
      }

      const pos = new Map()
      shown.forEach((lane, li) => lane.tasks.forEach((t) => {
        pos.set(`${lane.owner}:${t.num}`, { x: PAD + t.col * (NW + GAP), y: li * LH + (LH - NH) / 2 })
      }))
      const ghosts = missing
        .filter((m) => pos.has(`${m.lane.owner}:${m.task.num}`))
        .map((m) => {
          const source = pos.get(`${m.lane.owner}:${m.task.num}`)
          return { ...m, x: source.x + NW + GAP, y: source.y }
        })
      let maxCol = 0
      shown.forEach((l) => l.tasks.forEach((t) => { maxCol = Math.max(maxCol, t.col) }))
      ghosts.forEach((g) => { maxCol = Math.max(maxCol, Math.round((g.x - PAD) / (NW + GAP))) })
      const width = PAD * 2 + (maxCol + 1) * NW + maxCol * GAP
      const height = Math.max(shown.length * LH, LH)

      const edges = []
      for (const lane of shown) {
        const ownerMap = byOwner.get(lane.owner)
        for (const t of lane.tasks) {
          if (!visibleTask(t, lane)) continue
          const to = pos.get(`${lane.owner}:${t.num}`)
          for (const dep of t.depends ?? []) {
            const depTask = ownerMap?.get(dep)
            if (depTask) {
              if (!visibleTask(depTask, lane)) continue
              const from = pos.get(`${lane.owner}:${dep}`)
              if (from && to) edges.push({ from, to, missing: false })
            } else if (to) {
              const ghost = ghosts.find((g) => g.task.num === t.num && g.dep === dep)
              if (ghost) edges.push({ from: to, to: { x: ghost.x, y: ghost.y }, missing: true })
            }
          }
        }
      }

      const edgePath = (a, b) => {
        const x1 = a.x + NW
        const y1 = a.y + NH / 2
        const x2 = b.x
        const y2 = b.y + NH / 2
        const dx = Math.max(36, Math.abs(x2 - x1) / 2)
        return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
      }

      const changeOptions = [{ v: 'all', label: '全部 change' }, ...project.changes.filter((c) => !c.archived).map((c) => ({ v: c.id, label: c.id }))]
      if (lanes.some((l) => l.owner === 'global')) changeOptions.push({ v: 'global', label: '全局任务' })

      const notice = missing.length
        ? h('div', { className: 'notice', role: 'status' },
            h(Icon, { name: 'alert' }),
            h('div', { className: 'notice-body' },
              h('strong', null, `${missing.length} 个悬空依赖`),
              h('span', { className: 'notice-list' },
                missing.slice(0, 6).map((m) => `${m.lane.ownerLabel} · ${m.task.num} → ${m.dep}`).join('；'))),
            h('button', {
              className: 'btn btn-sm',
              onClick: () => setUi((s) => ({ ...s, graph: { ...s.graph, mode: 'all', change: missing[0].lane.owner } })),
            }, '定位'))
        : null

      const filterBar = h('div', { className: 'filter-bar' },
        h('div', { className: 'seg', role: 'group', 'aria-label': '完成状态过滤' },
          h('button', {
            className: `seg-btn ${filter.mode === 'all' ? 'is-active' : ''}`,
            'aria-pressed': filter.mode === 'all',
            onClick: () => setUi((s) => ({ ...s, graph: { ...s.graph, mode: 'all' } })),
          }, '全部'),
          h('button', {
            className: `seg-btn ${filter.mode === 'open' ? 'is-active' : ''}`,
            'aria-pressed': filter.mode === 'open',
            onClick: () => setUi((s) => ({ ...s, graph: { ...s.graph, mode: 'open' } })),
          }, '只看未完成')),
        h('div', { className: 'select-wrap' },
          h(Icon, { name: 'branch', cls: 'i-sm' }),
          h('select', {
            'aria-label': '按 change 过滤',
            value: filter.change,
            onChange: (e) => setUi((s) => ({ ...s, graph: { ...s.graph, change: e.target.value } })),
          }, changeOptions.map((o) => h('option', { key: o.v, value: o.v }, o.label))),
          h(Icon, { name: 'chevron-down', cls: 'i-sm select-chev' })),
        h('button', {
          className: 'btn btn-sm',
          onClick: () => setUi((s) => ({ ...s, graph: { ...s.graph, collapsed: !s.graph.collapsed } })),
        }, h(Icon, { name: 'layers', cls: 'i-sm' }), ' ', filter.collapsed ? '展开到任务级' : '折叠为功能级'),
        h('span', { className: 'filter-count' }, `${visibleCount} / ${total} 个任务`))

      const legend = h('div', { className: 'graph-foot' },
        h('span', { className: 'legend-item' }, h('span', { className: 'legend-node is-done' }, h(Icon, { name: 'check', cls: 'i-sm' })), '已完成'),
        h('span', { className: 'legend-item' }, h('span', { className: 'legend-node' }), '未完成'),
        h('span', { className: 'legend-item' }, h('span', { className: 'legend-edge' }), '依赖边'),
        h('span', { className: 'legend-item' }, h('span', { className: 'legend-edge is-missing' }), '悬空依赖'),
        h('span', { className: 'graph-hint' }, '点击节点打开对应 change；图表可横向滚动'))

      let panel
      if (!visibleCount) {
        panel = h('div', { className: 'graph-panel' },
          h('div', { className: 'graph-none' },
            h('p', null, '没有符合当前过滤条件的任务。'),
            h('button', {
              className: 'btn btn-sm',
              onClick: () => setUi((s) => ({ ...s, graph: { mode: 'all', change: 'all', collapsed: s.graph.collapsed } })),
            }, '清除过滤')),
          legend)
      } else if (filter.collapsed) {
        panel = h('div', { className: 'graph-panel' },
          h('div', { className: 'collapsed-list' }, shown.map((lane) => {
            const stats = statsOf([lane.group])
            const cross = lane.tasks.reduce((n, t) => n + (t.depends ?? []).filter((d) => {
              const target = lanes.find((l) => l.owner === lane.owner && l.tasks.some((x) => x.num === d))
              return target && target !== lane
            }).length, 0)
            return h('div', { className: 'collapsed-card', key: `${lane.owner}:${lane.group.index}` },
              h('div', { className: 'collapsed-main' },
                h('span', { className: 'collapsed-owner mono' }, lane.ownerLabel),
                h('span', { className: 'collapsed-title' }, h('span', { className: 'mono' }, `${lane.group.index}.`), ' ', lane.group.title),
                h('span', { className: 'collapsed-meta' },
                  `${stats.total} 个任务 · ${stats.done} 已完成${cross ? ` · ${cross} 条跨组依赖` : ''}`)),
              h('div', { className: 'collapsed-side' },
                h('span', { className: 'mono' }, `${stats.done}/${stats.total}`),
                h(Progress, { done: stats.done, total: stats.total }),
                lane.scope === 'change'
                  ? h('button', { className: 'btn btn-sm', onClick: () => actions.openChange(lane.changeId) }, '打开')
                  : h('span', { className: 'chip chip-skip' }, '全局')))
          })),
          legend)
      } else {
        panel = h('div', { className: 'graph-panel' },
          h('div', { className: 'graph-body' },
            h('div', { className: 'graph-lanes' }, shown.map((lane) => {
              const stats = statsOf([lane.group])
              return h('div', { className: 'lane-label', key: `${lane.owner}:${lane.group.index}`, style: { height: LH } },
                h('div', { className: 'lane-top' },
                  h('span', { className: 'lane-owner', title: lane.ownerLabel }, lane.ownerLabel),
                  h('span', { className: 'lane-count' }, `${stats.done}/${stats.total}`)),
                h('div', { className: 'lane-title' },
                  h('span', { className: 'lane-index mono' }, `${lane.group.index}.`),
                  lane.group.title))
            })),
            h('div', { className: 'graph-scroll', tabIndex: 0, 'aria-label': '任务依赖图，可横向滚动' },
              h('div', { className: 'graph-canvas', style: { width, height } },
                shown.map((lane, i) => h('div', {
                  key: `band-${lane.owner}:${lane.group.index}`,
                  className: `lane-band ${i === shown.length - 1 ? 'is-last' : ''}`,
                  style: { top: i * LH, height: LH },
                })),
                h('svg', { className: 'g-edges', width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': true, focusable: 'false' },
                  h('defs', null,
                    h('marker', { id: 'sb-arrow-dep', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto' },
                      h('path', { d: 'M0,0 L8,4 L0,8 Z', fill: 'var(--dep)' })),
                    h('marker', { id: 'sb-arrow-red', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto' },
                      h('path', { d: 'M0,0 L8,4 L0,8 Z', fill: 'var(--red)' }))),
                  edges.map((e, i) => h('path', {
                    key: i,
                    className: `edge ${e.missing ? 'is-missing' : ''}`,
                    d: edgePath(e.from, e.to),
                    markerEnd: `url(#sb-arrow-${e.missing ? 'red' : 'dep'})`,
                  }))),
                shown.flatMap((lane) => lane.tasks.filter((t) => visibleTask(t, lane)).map((t) => {
                  const p = pos.get(`${lane.owner}:${t.num}`)
                  const issue = missing.some((m) => m.lane.owner === lane.owner && m.task.num === t.num)
                  return h('button', {
                    key: `${lane.owner}:${t.num}`,
                    className: `g-node ${t.done ? 'is-done' : ''} ${issue ? 'has-issue' : ''}`,
                    style: { left: p.x, top: p.y },
                    title: `${t.num} ${t.title} · ${t.done ? '已完成' : '未完成'}`,
                    onClick: () => (lane.scope === 'change' ? actions.openChange(lane.changeId) : actions.toast('全局任务不隶属于单个 change', 'info')),
                  },
                    h('span', { className: 'node-num' }, t.num),
                    h('span', { className: 'node-title' }, t.title),
                    t.done ? h('span', { className: 'node-check' }, h(Icon, { name: 'check', cls: 'i-sm' })) : null,
                    issue ? h('span', { className: 'node-issue', title: '存在悬空依赖' }) : null)
                })),
                ghosts.map((g, i) => h('div', {
                  key: `ghost-${i}`,
                  className: 'g-node is-ghost',
                  style: { left: g.x, top: g.y },
                  title: `depends: ${g.dep}（任务不存在）`,
                },
                  h('span', { className: 'node-num' }, g.dep),
                  h('span', { className: 'node-title' }, '依赖缺失 · 未定义任务'),
                  h('span', { className: 'node-alert' }, h(Icon, { name: 'alert', cls: 'i-sm' }))))))),
          legend)
      }

      return h('section', { className: 'view wrap-graph' },
        h(PageHead, {
          title: '任务图',
          sub: h(React.Fragment, null,
            `${total} 个任务`,
            h('span', { className: 'sep' }, '·'),
            `${doneCount} 个已完成`,
            h('span', { className: 'sep' }, '·'),
            `${project.changes.filter((c) => !c.archived).length} 个 change`,
            lanes.some((l) => l.owner === 'global') ? ' + 全局任务' : ''),
        }),
        notice,
        filterBar,
        panel)
    }

    /* ------------------------------------------------------------------- shell */

    function App() {
      const [projects, setProjects] = useState([])
      const [root, setRoot] = useState(() => {
        try { return localStorage.getItem(ROOT_KEY) || '' } catch { return '' }
      })
      const [project, setProject] = useState(null)
      const [changeId, setChangeId] = useState(null)
      const [view, setView] = useState('list')
      const [theme, setTheme] = useState(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'))
      const [syncing, setSyncing] = useState(false)
      const [menuOpen, setMenuOpen] = useState(false)
      const [deleting, setDeleting] = useState(null)
      const [confirmText, setConfirmText] = useState('')
      const [error, setError] = useState(null)
      const [toasts, setToasts] = useState([])
      const [caps, setCaps] = useState({})
      const [designOpen, setDesignOpen] = useState({})
      const [drafts, setDrafts] = useState({})
      const [dirty, setDirty] = useState({})
      const [conflict, setConflict] = useState({})
      const [newDraft, setNewDraft] = useState('')
      const [newError, setNewError] = useState('')
      const [showArchived, setShowArchived] = useState(false)
      const [graph, setGraph] = useState({ mode: 'all', change: 'all', collapsed: false })
      const ui = { caps, designOpen, drafts, dirty, conflict, newDraft, newError, showArchived, graph }
      const setUi = useCallback((patch) => {
        const next = typeof patch === 'function' ? patch({ caps, designOpen, drafts, dirty, conflict, newDraft, newError, showArchived, graph }) : patch
        if (!next) return
        if (next.caps !== undefined) setCaps(next.caps)
        if (next.designOpen !== undefined) setDesignOpen(next.designOpen)
        if (next.drafts !== undefined) setDrafts(next.drafts)
        if (next.dirty !== undefined) setDirty(next.dirty)
        if (next.conflict !== undefined) setConflict(next.conflict)
        if (next.newDraft !== undefined) setNewDraft(next.newDraft)
        if (next.newError !== undefined) setNewError(next.newError)
        if (next.showArchived !== undefined) setShowArchived(next.showArchived)
        if (next.graph !== undefined) setGraph(next.graph)
      }, [caps, designOpen, drafts, dirty, conflict, newDraft, newError, showArchived, graph])

      // 样式表只注入一次（已由 scripts/build-css.mjs 限定在 .sb-app 下）；
      // 每次挂载都重新取一次，避免改了样式还要重启 Host。
      useEffect(() => {
        let alive = true
        fetch('/dsh-specboard/ui/style.css', { cache: 'no-store' })
          .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`style ${r.status}`))))
          .then((css) => {
            if (!alive) return
            let el = document.getElementById('sb-style')
            if (!el) {
              el = document.createElement('style')
              el.id = 'sb-style'
              document.head.appendChild(el)
            }
            el.textContent = css
          })
          .catch(() => {})
        return () => { alive = false }
      }, [])

      const toast = useCallback((message, kind = 'info') => {
        const id = Math.random().toString(36).slice(2)
        setToasts((list) => [...list.slice(-2), { id, message, kind }])
        setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3400)
      }, [])

      const loadProjects = useCallback(async () => {
        try {
          const data = await api('/projects')
          setProjects(data.projects)
          return data.projects
        } catch (e) {
          setError(String(e.message ?? e))
          return []
        }
      }, [])

      const loadProject = useCallback(async (targetRoot, targetChange) => {
        if (!targetRoot) return null
        setSyncing(true)
        try {
          const data = await api('/project?' + qs({ root: targetRoot, change: targetChange }))
          setProject(data)
          setError(null)
          return data
        } catch (e) {
          setError(e.payload?.error ?? String(e.message ?? e))
          setProject(null)
          return null
        } finally {
          setSyncing(false)
        }
      }, [])

      useEffect(() => {
        ;(async () => {
          const list = await loadProjects()
          if (!list.length) return
          const keep = list.find((p) => p.root === root && p.changeCount > 0)
          const best = list.reduce((a, b) => (b.changeCount > a.changeCount ? b : a), list[0])
          const next = keep ? keep.root : best.changeCount > 0 ? best.root : list[0].root
          setRoot(next)
          try { localStorage.setItem(ROOT_KEY, next) } catch {}
        })()
      }, [])

      useEffect(() => {
        if (!root) return
        loadProject(root, changeId)
      }, [root, changeId, loadProject])

      // AI 调 specboard_refresh 或任何写操作后，SSE 推送刷新
      useEffect(() => {
        let source
        try {
          source = new EventSource(API + '/events')
          const onRefresh = () => {
            // 新项目可能刚出现：同时刷新项目列表，让下拉里能看到它
            loadProjects()
            if (root) loadProject(root, changeId)
          }
          source.addEventListener('refresh', onRefresh)
          return () => { source.removeEventListener('refresh', onRefresh); source.close() }
        } catch {
          return undefined
        }
      }, [root, changeId, loadProject])

      const refresh = useCallback(async () => {
        const list = await loadProjects()
        if (!list.some((p) => p.root === root) && list.length) setRoot(list[0].root)
        else await loadProject(root, changeId)
        toast('已同步数据目录', 'success')
      }, [loadProjects, loadProject, root, changeId, toast])

      const actions = useMemo(() => ({
        setView: (next) => {
          setView(next)
          if (next === 'list') setChangeId(null)
          window.scrollTo({ top: 0 })
        },
        openChange: (id) => {
          setChangeId(id)
          setView('detail')
        },
        toggleMenu: () => setMenuOpen((v) => !v),
        requestDelete: (p) => {
          setMenuOpen(false)
          setConfirmText('')
          setDeleting(p)
        },
        cancelDelete: () => {
          setDeleting(null)
          setConfirmText('')
        },
        confirmDelete: async (target, confirm) => {
          if (!target) return
          try {
            const result = await post('/delete-project', { root: target.root, confirm })
            toast(`已删除 ${target.name} 的 openspec（${result.files} 个文件）`, 'success')
            setDeleting(null)
            setConfirmText('')
            const list = await loadProjects()
            if (target.root === root) {
              const next = list[0]
              setChangeId(null)
              setView('list')
              setProject(null)
              setRoot(next ? next.root : '')
            } else {
              await loadProject(root, changeId)
            }
          } catch (e) {
            toast('删除失败：' + (e.payload?.error ?? e.message), 'error')
          }
        },
        selectProject: (nextRoot) => {
          setMenuOpen(false)
          setRoot(nextRoot)
          setChangeId(null)
          setView('list')
          try { localStorage.setItem(ROOT_KEY, nextRoot) } catch {}
        },
        refresh,
        toggleTheme: () => {
          const next = theme === 'dark' ? 'light' : 'dark'
          setTheme(next)
          try { localStorage.setItem(THEME_KEY, next) } catch {}
        },
        toast,
        focusNew: () => {
          const el = document.querySelector('.sb-app [data-new-id], .sb-app .creator input')
          if (el) el.focus()
        },
        showValidation: async (change) => {
          const hints = (change.issues ?? []).map((i) => i.message)
          try {
            const result = await api('/validate?' + qs({ root, change: change.id }))
            if (!result.available) {
              if (!hints.length) toast('未安装校验 CLI；本地校验通过', 'success')
              else toast(`本地校验：${hints.join('；')}`, 'warn')
              return
            }
            if (result.ok) {
              toast('CLI 校验通过', 'success')
              return
            }
            const detail = (result.stderr || result.stdout || '').slice(0, 240)
            toast('CLI 校验失败：' + detail, 'error')
          } catch (e) {
            toast('校验失败：' + (e.payload?.error ?? e.message), 'error')
          }
        },
        approveTech: async (changeId, kind) => {
          try {
            await post('/approve-tech', { root, changeId, kind })
            await loadProject(root, changeId)
            toast(kind === 'structure' ? '已确认工程结构' : '已确认数据模型', 'success')
          } catch (e) {
            toast('确认失败：' + (e.payload?.error ?? e.message), 'error')
          }
        },
        addGroup: async (file, title) => {
          try {
            await post('/add-group', {
              root,
              changeId: file === 'global' ? undefined : project?.change?.id,
              file,
              capability: file === 'global' ? 'global' : null,
              title,
            })
            await loadProject(root, changeId)
            toast('已新增任务组', 'success')
          } catch (e) {
            toast('新增失败：' + (e.payload?.error ?? e.message), 'error')
          }
        },
        deleteGroup: async (file, group) => {
          try {
            await post('/delete-group', {
              root,
              changeId: file === 'global' ? undefined : project?.change?.id,
              file,
              group,
            })
            await loadProject(root, changeId)
            toast('已删除任务组', 'success')
          } catch (e) {
            toast('删除失败：' + (e.payload?.error ?? e.message), 'error')
          }
        },
        hintDesign: () => toast(LABELS.continueHint, 'info'),
        saveDelta: async (changeId, capability, delta, expectedHash, requirePurpose) => {
          try {
            await post('/save-delta', { root, changeId, capability, delta, expectedHash, requirePurpose })
            await loadProject(root, changeId)
            toast(`已保存 ${capability} 的 spec`, 'success')
            return true
          } catch (e) {
            toast('保存失败：' + (e.payload?.error ?? e.message), 'error')
            await loadProject(root, changeId)
            return false
          }
        },
        saveDesign: async (changeId, draft) => {
          const change = project?.change
          let hash = change?.hashes?.design ?? null
          const sections = [['context', 'Context'], ['goals', 'Goals / Non-Goals'], ['decisions', 'Decisions'], ['risks', 'Risks / Trade-offs']]
          try {
            for (const [key, heading] of sections) {
              const result = await post('/save-section', {
                root, changeId, artifact: 'design', section: heading,
                content: draft[key] ?? '', expectedHash: hash,
              })
              hash = result.hash
            }
            await loadProject(root, changeId)
            toast('已保存 design.md', 'success')
            return true
          } catch (e) {
            toast('保存失败：' + (e.payload?.error ?? e.message), 'error')
            await loadProject(root, changeId)
            return false
          }
        },
        createChange: async (id) => {
          const value = String(id ?? '').trim()
          if (!value) return setNewError('请输入 kebab-case id，例如 add-command-palette')
          if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)) return setNewError('id 需为 kebab-case：小写字母开头，单词间用连字符')
          try {
            await post('/create-change', { root, id: value })
            setNewDraft('')
            setNewError('')
            const list = await loadProjects()
            const hit = list.find((p) => p.root === root)
            if (hit) setRoot(root)
            await loadProject(root, null)
            toast(`已创建 ${value} · 等待生成 proposal`, 'success')
          } catch (e) {
            setNewError(e.payload?.error ?? e.message)
          }
        },
        toggleTask: async (scope, groupIndex, task) => {
          try {
            const change = project?.change
            await post('/toggle-task', {
              root,
              changeId: scope === 'global' ? undefined : change?.id,
              file: scope === 'global' ? 'global' : 'tasks',
              line: task.line,
              done: !task.done,
            })
            await loadProject(root, changeId)
          } catch (e) {
            toast('勾选失败：' + (e.payload?.error ?? e.message), 'error')
          }
        },
        addTask: async (scope, groupIndex, text) => {
          try {
            const change = project?.change
            await post('/add-task', {
              root,
              changeId: scope === 'global' ? undefined : change?.id,
              file: scope === 'global' ? 'global' : 'tasks',
              group: groupIndex,
              text,
            })
            await loadProject(root, changeId)
            toast('已添加任务', 'success')
          } catch (e) {
            toast('添加失败：' + (e.payload?.error ?? e.message), 'error')
          }
        },
        saveField: async (id, field, value) => {
          const change = project?.change
          if (!change) return
          const key = `${id}/${field}`
          try {
            const result = await post('/save-section', {
              root,
              changeId: id,
              artifact: 'proposal',
              section: field === 'why' ? 'Why' : field === 'changes' ? 'What Changes' : 'Impact',
              content: value,
              expectedHash: change.hashes?.proposal,
            })
            setDrafts((d) => { const next = { ...d }; delete next[key]; return next })
            setDirty((d) => { const next = { ...d }; delete next[key]; return next })
            setConflict((c) => ({ ...c, [id]: false }))
            await loadProject(root, changeId)
            toast('已保存 proposal.md', 'success')
            return result
          } catch (e) {
            setConflict((c) => ({ ...c, [id]: true }))
            toast('保存失败：' + (e.payload?.error ?? e.message), 'error')
          }
        },
        reloadProposal: async (id) => {
          ['why', 'changes', 'impact'].forEach((field) => {
            const key = `${id}/${field}`
            setDrafts((d) => { const next = { ...d }; delete next[key]; return next })
            setDirty((d) => { const next = { ...d }; delete next[key]; return next })
          })
          setConflict((c) => ({ ...c, [id]: false }))
          await loadProject(root, changeId)
          toast('已重新加载 proposal.md', 'success')
        },
        forceProposal: async (id) => {
          const change = project?.change
          if (!change) return
          try {
            for (const field of ['why', 'changes', 'impact']) {
              const key = `${id}/${field}`
              const value = drafts[key] ?? change.proposal?.[field] ?? ''
              await post('/save-section', {
                root,
                changeId: id,
                artifact: 'proposal',
                section: field === 'why' ? 'Why' : field === 'changes' ? 'What Changes' : 'Impact',
                content: value,
                expectedHash: null,
              })
              setDrafts((d) => { const next = { ...d }; delete next[key]; return next })
              setDirty((d) => { const next = { ...d }; delete next[key]; return next })
            }
            setConflict((c) => ({ ...c, [id]: false }))
            await loadProject(root, changeId)
            toast('已强制覆盖 proposal.md', 'success')
          } catch (e) {
            toast('覆盖失败：' + (e.payload?.error ?? e.message), 'error')
          }
        },
      }), [theme, refresh, toast, root, changeId, project, loadProjects, loadProject, drafts])

      const detail = project?.change ?? null
      LABELS = {
        ...DEFAULT_LABELS,
        ...(project?.labels ?? {}),
        files: { ...DEFAULT_LABELS.files, ...(project?.labels?.files ?? {}) },
        adapterLabel: project?.adapter?.label ?? '',
      }
      const currentProject = project
        ? { ...project, status: 'ok', name: project.name, changes: project.changes }
        : projects.find((p) => p.root === root)
          ? { ...projects.find((p) => p.root === root), status: 'ok', changes: [], globalTasks: { groups: [] } }
          : { root, name: '未识别项目', status: 'error', changes: [], globalTasks: { groups: [] }, archivedCount: 0 }

      return h('div', { className: 'sb-app', 'data-theme': theme },
        h(Toolbar, {
          project: currentProject,
          projects,
          view,
          theme,
          syncing,
          menuOpen,
          actions,
        }),
        h('main', { className: 'app' + (syncing ? ' is-syncing' : '') },
          error ? h('div', { className: 'error-bar', role: 'alert' }, h(Icon, { name: 'alert' }), h('div', null, h('strong', null, '读取失败'), h('p', null, error))) : null,
          !project && !error
            ? (projects.length === 0
                ? h('div', { className: 'empty' },
                    h('h3', null, '没有找到 OpenSpec 项目'),
                    h('p', null, '在项目根目录执行 openspec init，或把项目放进当前工作区后点刷新。'))
                : h('div', { className: 'sync-note-wrap' }, h('div', { className: 'sync-note', role: 'status' }, h('span', { className: 'spinner' }), '正在读取数据…')))
            : null,
          project && view === 'graph'
            ? h(GraphView, { project, ui, setUi, actions })
            : project && view === 'detail' && detail
              ? h(DetailView, { project, change: detail, ui, setUi, actions })
              : project
                ? h(ListView, { project, busy: syncing, actions, ui, setUi })
                : null),
        deleting
          ? h('div', { className: 'danger-overlay', onClick: actions.cancelDelete },
              h('div', { className: 'danger-modal', onClick: (e) => e.stopPropagation() },
                h('h3', null, '删除项目文档'),
                h('p', null, `将永久删除「${deleting.name}」下的 openspec/ 目录（${deleting.changeCount} 个需求、${deleting.archivedCount} 个已归档）。代码文件不受影响。`),
                h('p', { className: 'sb-small sb-muted mono' }, deleting.root),
                h('label', { className: 'sub-label' }, `输入项目名 ${deleting.name} 以确认`),
                h('input', {
                  className: 'field',
                  value: confirmText,
                  placeholder: deleting.name,
                  onChange: (e) => setConfirmText(e.target.value),
                  autoFocus: true,
                }),
                h('div', { className: 'editor-actions' },
                  h('button', { className: 'btn', onClick: actions.cancelDelete }, '取消'),
                  h('button', {
                    className: 'btn btn-danger',
                    disabled: confirmText !== deleting.name,
                    onClick: () => actions.confirmDelete(deleting, confirmText),
                  }, '永久删除'))))
          : null,
        h('div', { className: 'toasts', role: 'status', 'aria-live': 'polite' }, toasts.map((t) => h(Toast, { key: t.id, toast: t }))))
    }

    function PanelRoot() {
      return h(App)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: 'SpecBoard',
        }, Icon0))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, PanelRoot))
      },
    }

    function Icon0(props) {
      const size = props?.size ?? 18
      return h('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 3, y: 4, width: 18, height: 4.6, rx: 1.6, fill: 'currentColor', opacity: 0.95 }),
        h('rect', { x: 3, y: 10.6, width: 12, height: 4.6, rx: 1.6, fill: 'currentColor', opacity: 0.7 }),
        h('rect', { x: 3, y: 17.2, width: 15, height: 4.6, rx: 1.6, fill: 'currentColor', opacity: 0.45 }),
        h('path', { d: 'M15.2 12.8l1.9 1.9 3.3-3.9', fill: 'none', stroke: '#7ee787', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }
  },
})
