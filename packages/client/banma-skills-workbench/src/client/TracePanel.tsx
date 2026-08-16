/**
 * Right-column workbench panel (the `details` occupant): the live
 * skill-execution trace rendered as a timeline — every node carries its tool
 * name, argument input, rendered output, and a striking red error state.
 * Newest nodes first, with skill-load / tool filters and a close action.
 * A file preview replaces the trace while one is active.
 * @module @deepseek-ai/dsh-client-banma-skills-workbench/client/TracePanel
 */

import { useEffect, useMemo, useState } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-layout's SlotMap merge so PropsRuntime<'details'> resolves.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SkillsWorkbenchInjected } from './workbench.ts'
import { deriveTrace, type WorkbenchTraceEntry } from './trace.ts'
import css from './SkillsWorkbench.module.css'

/** Composed props: the details runtime share plus the workbench inject face. */
export type TracePanelProps = PropsRuntime<'details'> & InjectFace<SkillsWorkbenchInjected>

/** Trace filter axis. */
type TraceFilter = 'all' | 'skill-load' | 'tool'

const FILTERS: readonly (readonly [TraceFilter, string])[] = [
  ['all', '全部'],
  ['skill-load', 'Skill 加载'],
  ['tool', '工具'],
]

/** Local hh:mm:ss from an epoch-ms timestamp. */
function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Pretty-print an argument JSON string for the input pane; fall back to raw. */
function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw) as unknown, null, 2)
  } catch {
    return raw
  }
}

/**
 * Render the skills execution trace column, or a file preview while one is
 * active.
 * @param props - details runtime share and the workbench inject face.
 * @returns the trace or preview panel.
 */
export function TracePanel({ useSkillsWorkbench, actions }: TracePanelProps) {
  const wb = useSkillsWorkbench(snapshot => snapshot)
  const [filter, setFilter] = useState<TraceFilter>('all')
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(new Set())
  const trace = useMemo(() => deriveTrace(wb.conversation), [wb.conversation])

  // The frame closes the details column on session switch; reopen it so the
  // trace stays on screen across navigation.
  useEffect(() => {
    if (wb.currentId !== undefined) actions.openDetails()
  }, [wb.currentId, actions])

  if (wb.preview !== null) {
    const preview = wb.preview
    const name = preview.path.split(/[\\/]/).pop() ?? preview.path
    return (
      <div className={css.trace}>
        <div className={css.traceHead}>
          <span className={css.traceTitle}>{name}</span>
          <div className={css.traceActions}>
            <button type="button" className={css.btn} onClick={actions.closePreview} title="返回轨迹">轨迹</button>
            <button type="button" className={css.btn} onClick={actions.closeDetails} title="关闭">✕</button>
          </div>
        </div>
        <div className={css.previewPath}>{preview.path}</div>
        {preview.error !== undefined ? (
          <div className={css.previewError}>{preview.error}</div>
        ) : (
          <pre className={css.previewBody}>{preview.content}</pre>
        )}
      </div>
    )
  }

  const visible = filter === 'all' ? trace : trace.filter(entry => entry.kind === filter)
  const ordered = useMemo(() => [...visible].reverse(), [visible])

  const toggleExpanded = (key: string): void => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <div className={css.trace}>
      <div className={css.traceHead}>
        <span className={css.traceTitle}>Skills 执行轨迹</span>
        <div className={css.traceActions}>
          <button type="button" className={css.btn} onClick={actions.closeDetails} title="关闭">✕</button>
        </div>
      </div>
      <div className={css.traceFilters}>
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`${css.chip}${filter === value ? ` ${css.chipOn}` : ''}`}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {wb.currentId === undefined ? (
        <div className={css.emptyWide}>当前无会话，等待会话开始后显示轨迹…</div>
      ) : ordered.length === 0 ? (
        <div className={css.emptyWide}>暂无轨迹。模型调用 skill 或执行工具时，这里会实时出现记录。</div>
      ) : (
        <div className={css.timeline}>
          {ordered.map(entry => (
            <TimelineNode
              key={entry.key}
              entry={entry}
              expanded={expandedKeys.has(entry.key)}
              onToggle={() => toggleExpanded(entry.key)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** One timeline node: dot rail, summary head, and an expandable input/output/error body. */
function TimelineNode({
  entry,
  expanded,
  onToggle,
}: {
  entry: WorkbenchTraceEntry
  expanded: boolean
  onToggle: () => void
}) {
  const failed = !entry.running && !entry.ok
  return (
    <div className={`${css.tlNode} ${entry.running ? '' : entry.ok ? css.nodeOk : css.nodeErr}`}>
      <div className={css.tlRail}>
        <span className={css.tlDot} />
      </div>
      <div className={css.tlBody}>
        <div className={css.tlCard}>
          <button type="button" className={css.tlHead} onClick={onToggle}>
            <span className={`${css.chev}${expanded ? ` ${css.chevOpen}` : ''}`}>▸</span>
            <span className={`${css.badge} ${entry.kind === 'skill-load' ? css.badgeSkill : css.badgeTool}`}>
              {entry.kind === 'skill-load' ? 'SKILL' : 'TOOL'}
            </span>
            <span className={css.traceTool}>{entry.tool}</span>
            {entry.skill !== null ? <span className={css.traceSkill}>· {entry.skill}</span> : null}
            {entry.running ? <span className={`${css.badge} ${css.badgeTool}`}>运行中</span> : null}
            {failed ? <span className={css.errBadge}>ERROR</span> : null}
            <span className={css.traceTime}>{fmtTime(entry.ts)}</span>
          </button>
          {expanded ? (
            <div className={css.tlDetail}>
              {entry.args !== null ? (
                <div className={css.tlSection}>
                  <div className={css.tlLabel}>输入</div>
                  <pre className={css.tlPre}>{prettyJson(entry.args)}</pre>
                </div>
              ) : null}
              {entry.output !== null ? (
                <div className={css.tlSection}>
                  <div className={css.tlLabel}>输出</div>
                  <pre className={css.tlPre}>{entry.output}</pre>
                </div>
              ) : null}
              {failed && entry.detail !== null ? (
                <div className={css.tlSection}>
                  <div className={css.tlLabel}>错误</div>
                  <div className={css.tlError}>{entry.detail}</div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
