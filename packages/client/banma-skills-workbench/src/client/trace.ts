/**
 * Pure projection of a session's skill-execution trace from its chat
 * snapshot. The workbench never listens to tools events itself: the Chat
 * target already folds the durable tool/call + tool/result lifecycle into
 * `tool-call` nodes, so the trace is a deterministic function of the
 * conversation the session view already publishes.
 * @module @deepseek-ai/dsh-client-banma-skills-workbench/client/trace
 */

import type { ConversationSnapshot, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'

/** One tool-execution row of the workbench trace. */
export interface WorkbenchTraceEntry {
  /** Stable chat-node key (React key source). */
  key: string
  /** Durable anchor seq, the trace's ordering axis. */
  seq: number
  /** Epoch-ms call time. */
  ts: number
  /** `skill-load` for the model-facing `skill` loader; `tool` for every other call. */
  kind: 'skill-load' | 'tool'
  /** Wire tool name. */
  tool: string
  /** Truncated JSON argument string (the call input), or `null`. */
  args: string | null
  /** Settled success only (`false` while running). */
  ok: boolean
  /** Whether the call is still in flight. */
  running: boolean
  /** Failure message for a settled error, else `null`. */
  detail: string | null
  /** Rendered result text (the call output; the skill body for a loaded skill), else `null`. */
  output: string | null
  /** Skill active when a tool ran: the last loaded skill before it, else `null`. */
  skill: string | null
  /** Parsed skill name for `skill-load` rows, else `null`. */
  skillName: string | null
}

/** The union arm the Chat target publishes once a tool call settles. */
type SettledToolBlock = Extract<ToolCallBlock, { kind: 'tool-result' }>

/** Narrow a Tool lifecycle to its settled arm. */
function isSettled(block: ToolCallBlock): block is SettledToolBlock {
  return 'kind' in block && block.kind === 'tool-result'
}

/** Tool display name across both lifecycle arms. */
function toolName(block: ToolCallBlock): string {
  return isSettled(block) ? (block.call?.name ?? 'tool') : block.name
}

/** Truncated argument JSON; the running arm keeps its raw string, the settled arm its call slice. */
const ARGS_MAX = 2000

function argsOf(block: ToolCallBlock): string | null {
  const raw = isSettled(block) ? block.call?.argsRaw : block.argsRaw
  if (typeof raw !== 'string' || raw === '') return null
  return raw.length > ARGS_MAX ? `${raw.slice(0, ARGS_MAX)}…` : raw
}

/** The `skill` loader's only argument is `{ name }`; parse it tolerantly (streaming can truncate JSON). */
export function parseSkillName(args: string | null): string | null {
  if (args === null) return null
  try {
    const parsed = JSON.parse(args) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      const name = (parsed as Record<string, unknown>).name
      if (typeof name === 'string' && name !== '') return name
    }
  } catch {
    // A truncated JSON prefix has no usable name.
  }
  return null
}

/** All text blocks of the rendered result joined with newlines, or `null`. */
function outputText(blocks: readonly unknown[] | undefined): string | null {
  if (blocks === undefined) return null
  const parts: string[] = []
  for (const block of blocks) {
    if (typeof block === 'object' && block !== null) {
      const candidate = block as { type?: unknown; text?: unknown }
      if (candidate.type === 'text' && typeof candidate.text === 'string') parts.push(candidate.text)
    }
  }
  return parts.length === 0 ? null : parts.join('\n')
}

/** Human-readable failure message, when the tool error carries one. */
function errorMessage(error: unknown): string | null {
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
  }
  return null
}

/** The bash tool's documented non-zero-exit marker: `[exit code: N]`. */
const EXIT_CODE_MARKER = /\[exit code: (-?\d+)\]/

/** Exit code parsed from a bash output marker, or `null`. */
function exitCodeOf(output: string | null): number | null {
  if (output === null) return null
  const match = EXIT_CODE_MARKER.exec(output)
  if (match === null || match[1] === undefined) return null
  const code = Number(match[1])
  return Number.isNaN(code) ? null : code
}

/** Whether a bash output carries a non-zero exit-code marker. */
function exitCodeFailure(output: string | null): boolean {
  const code = exitCodeOf(output)
  return code !== null && code !== 0
}

/** Human-readable error detail for a non-zero bash exit. */
function exitCodeDetail(output: string | null): string {
  const code = exitCodeOf(output)
  return code === null ? '命令退出码非零' : `命令退出码 ${code}`
}

/**
 * Project the ordered skill-execution trace of one conversation snapshot.
 * @param snapshot - the session's live conversation, or `undefined` while no session is current.
 * @returns tool rows in anchor-seq order, each tagged with the skill active when it ran.
 */
export function deriveTrace(snapshot: ConversationSnapshot | undefined): WorkbenchTraceEntry[] {
  if (snapshot === undefined) return []
  const entries: WorkbenchTraceEntry[] = []
  for (const node of snapshot.chat.nodes.values()) {
    if (node.target !== 'chat' || node.kind !== 'tool-call') continue
    const root = (node.data as { root?: ToolCallBlock | null } | undefined)?.root
    if (root === undefined || root === null) continue
    const settled = isSettled(root)
    const name = toolName(root)
    const args = argsOf(root)
    const output = settled ? outputText(root.content) : null
    // The bash tool reports non-zero exits as a SUCCESS with an `[exit code: N]`
    // marker in the output, so a raw `isError` check alone misses command
    // failures — treat a non-zero exit-code marker as an error as well.
    const exitError = exitCodeFailure(output)
    const isError = settled && (root.isError === true || exitError)
    entries.push({
      key: node.key,
      seq: node.anchorSeq,
      ts: root.time,
      kind: name === 'skill' ? 'skill-load' : 'tool',
      tool: name,
      args,
      ok: settled ? !isError : false,
      running: !settled,
      detail: settled && isError
        ? (exitError ? exitCodeDetail(output) : errorMessage(root.error))
        : null,
      output,
      skill: null,
      skillName: name === 'skill' ? parseSkillName(args) : null,
    })
  }
  entries.sort((a, b) => a.seq - b.seq)
  let active: string | null = null
  for (const entry of entries) {
    if (entry.kind === 'skill-load') {
      if (!entry.running && entry.ok && entry.skillName !== null) active = entry.skillName
    } else {
      entry.skill = active
    }
  }
  return entries
}

/**
 * Distinct successfully loaded skills, in first-load order, carrying their
 * rendered instruction bodies (the system prompt DSH injected for them).
 * @param entries - a derived trace.
 * @returns one row per activated skill.
 */
export function activatedSkills(entries: readonly WorkbenchTraceEntry[]): WorkbenchTraceEntry[] {
  const seen = new Map<string, WorkbenchTraceEntry>()
  for (const entry of entries) {
    if (entry.kind !== 'skill-load' || entry.running || !entry.ok || entry.skillName === null) continue
    if (!seen.has(entry.skillName)) seen.set(entry.skillName, entry)
  }
  return [...seen.values()]
}
