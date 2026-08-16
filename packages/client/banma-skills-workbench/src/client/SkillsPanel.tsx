/**
 * Left-column workbench panel (the `sidebar` occupant): the workspace
 * directory tree, the activated skills' system prompts, and the numbered
 * catalog of the current workspace below. Sections derive from the shared
 * workbench store — the trace rows come from the conversation snapshot, the
 * catalog from the connection `skill.list` RPC, the tree from the
 * `skillsWorkbench` Remote domain — and collapse independently.
 * @module @deepseek-ai/dsh-client-banma-skills-workbench/client/SkillsPanel
 */

import { useMemo, useState } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-layout's SlotMap merge so PropsRuntime<'sidebar'> resolves.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SkillsWorkbenchInjected } from './workbench.ts'
import { activatedSkills, deriveTrace } from './trace.ts'
import { DirectoryTree } from './DirectoryTree.tsx'
import css from './SkillsWorkbench.module.css'

/** Composed props: the sidebar runtime share plus the workbench inject face. */
export type SkillsPanelProps = PropsRuntime<'sidebar'> & InjectFace<SkillsWorkbenchInjected>

/** Last path segment of a session cwd, for the workspace label. */
function workspaceName(cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return ''
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? ''
}

/**
 * Render the skills workbench left column.
 * @param props - sidebar runtime share (collapsed/useSessions) and the workbench inject face.
 * @returns the panel, or the compact rail while the column is collapsed.
 */
export function SkillsPanel({ collapsed, useSessions, useSkillsWorkbench, actions }: SkillsPanelProps) {
  const wb = useSkillsWorkbench(snapshot => snapshot)
  const current = useSessions(s => s.current)
  const cwd = useSessions(s => current === undefined ? undefined : s.byId[current]?.cwd)
  const [openPrompt, setOpenPrompt] = useState(true)
  const [openList, setOpenList] = useState(true)
  const [openTree, setOpenTree] = useState(true)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const trace = useMemo(() => deriveTrace(wb.conversation), [wb.conversation])
  const activated = useMemo(() => activatedSkills(trace), [trace])
  const activatedByName = useMemo(
    () => new Map(activated.map(entry => [entry.skillName, entry] as const)),
    [activated],
  )
  const catalog = wb.catalog ?? []
  const workspace = workspaceName(cwd)

  const toggleExpanded = (name: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  if (collapsed) {
    return (
      <div className={css.rail}>
        <button type="button" className={css.railBtn} onClick={actions.toggleSidebar} title="展开 Skills 面板">❯</button>
        <div className={css.railLabel}>Skills</div>
      </div>
    )
  }

  return (
    <div className={css.panel}>
      <div className={css.header}>
        <div className={css.title}>斑马 · Skills 工作台</div>
        <div className={css.headerActions}>
          <button
            type="button"
            className={css.btn}
            onClick={() => {
              actions.closePreview()
              actions.openDetails()
            }}
            title="打开右侧 Skills 执行轨迹"
          >
            轨迹
          </button>
          <button type="button" className={css.btn} onClick={actions.refresh} title="刷新目录">↻</button>
          <button type="button" className={css.btn} onClick={actions.toggleSidebar} title="折叠侧栏">◀</button>
        </div>
      </div>
      <div className={css.toolbar}>
        <button type="button" className={css.toolbarBtn} onClick={actions.newSession}>＋ 新建会话</button>
        <button type="button" className={css.toolbarBtn} onClick={() => void actions.newWorkspace()}>＋ 新建工作区</button>
      </div>
      <div className={`${css.section} ${css.treeSection}`}>
        <button type="button" className={css.secHead} onClick={() => setOpenTree(!openTree)}>
          <span className={`${css.chev}${openTree ? ` ${css.chevOpen}` : ''}`}>▸</span>
          <span className={css.secTitle}>工作区目录</span>
          {workspace !== '' ? <span className={css.secBadge}>{workspace}</span> : null}
        </button>
        {openTree ? (
          <div className={`${css.secBody} ${css.treeBody}`}>
            <DirectoryTree root={cwd} fileTree={actions.fileTree} onPreview={path => void actions.openPreview(path)} />
          </div>
        ) : null}
      </div>
      <div className={css.section}>
        <button type="button" className={css.secHead} onClick={() => setOpenPrompt(!openPrompt)}>
          <span className={`${css.chev}${openPrompt ? ` ${css.chevOpen}` : ''}`}>▸</span>
          <span className={css.secTitle}>激活 Skills 系统提示词</span>
          <span className={css.secBadge}>{activated.length}</span>
        </button>
        {openPrompt ? (
          <div className={css.secBody}>
            {activated.length === 0 ? (
              <div className={css.empty}>
                本会话尚未通过 skill 工具加载任何 skill。在中间对话框让模型加载后，这里会显示其系统提示词（指令全文）。
              </div>
            ) : activated.map(entry => (
              <div key={entry.key} className={css.skillCard}>
                <div className={css.skillName}>{entry.skillName}</div>
                <pre className={css.pre}>{entry.output ?? '（无指令内容）'}</pre>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className={css.section}>
        <button type="button" className={css.secHead} onClick={() => setOpenList(!openList)}>
          <span className={`${css.chev}${openList ? ` ${css.chevOpen}` : ''}`}>▸</span>
          <span className={css.secTitle}>可用 Skills（当前工作空间）</span>
          <span className={css.secBadge}>{catalog.length}</span>
        </button>
        {openList ? (
          <div className={css.secBody}>
            {wb.catalogError !== null ? <div className={css.error}>{wb.catalogError}</div> : null}
            {wb.catalog === null && wb.catalogError === null ? <div className={css.empty}>正在加载目录…</div> : null}
            {wb.catalog !== null && catalog.length === 0 ? <div className={css.empty}>当前工作空间没有可用 skills。</div> : null}
            {catalog.map((skill, index) => {
              const active = activatedByName.get(skill.name)
              const open = expanded.has(skill.name)
              return (
                <div key={skill.name} className={css.row}>
                  <button type="button" className={css.rowLine} onClick={() => toggleExpanded(skill.name)}>
                    <span className={css.rowNum}>{index + 1}.</span>
                    <span className={css.rowName}>{skill.name}</span>
                    {skill.modelInvocable ? null : <span className={css.rowTag}>user-only</span>}
                  </button>
                  <div className={css.rowDesc}>{skill.description || '（无描述）'}</div>
                  {open ? (
                    <pre className={css.pre}>
                      {active !== undefined
                        ? (active.output ?? '（无指令内容）')
                        : skill.whenToUse !== undefined
                          ? `适用场景：${skill.whenToUse}`
                          : '（尚未加载；让模型通过 skill 工具加载后可在上方查看完整指令）'}
                    </pre>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
