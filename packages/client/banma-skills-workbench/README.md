# @deepseek-ai/dsh-client-banma-skills-workbench

English | [中文](README.zh.md)

Skills workbench UI, browser half: replaces the left sidebar (`sidebar` slot) with the skill catalog plus the activated skills' system prompts, and the right details column (`details` slot) with the live skill-execution trace.

## Left panel: 斑马 · Skills 工作台

The `sidebar` occupant renders two collapsible sections above the panel header (current session short id and workspace name):

- **激活 Skills 系统提示词** — every skill the session loaded through the model-facing `skill` tool, in first-load order, with its rendered instruction body (the exact prompt DSH injected for it). Rows are `{name, content}` pairs derived from the conversation snapshot's settled `skill` tool-call result content.
- **可用 Skills（当前工作空间）** — the numbered `skill.list` catalog (`{name, description, whenToUse, modelInvocable}`) for the current session's project, resolved host-side from the session header `cwd`. Rows expand to show the loaded body when the skill was activated, `whenToUse` otherwise, or a loading hint. A `user-only` tag marks `modelInvocable: false` entries.

While the column is collapsed the panel renders the compact rail with an expand button.

## Right panel: Skills 执行轨迹

The `details` occupant renders every tool execution of the session as a time-ordered trace — `SKILL` badge for the `skill` loader, `TOOL` badge for other calls, each tagged with the skill active when it ran, plus call time, truncated arguments, running/ok/error state, and the failure message. Filters show all rows, skill loads only, or tools only. The panel reopens the details column when the session changes.

## Data flow

Both panels read one shared workbench store (`createSnapshotStore`) exposed through the registration inject `hooks` compartment as `useSkillsWorkbench`. The `WorkbenchController` (apply-world) owns every subscription: it tracks the current session through `ctx.sessions.list`, binds that session's conversation face (`SessionBinding.session`, an `ObservableSnapshot<ConversationSnapshot>`), and fetches the catalog through the read-only connection `skill.list` RPC on session change plus a 15-second cadence (the host forwards no `skills/change` event). The trace itself is a pure projection (`deriveTrace`) over the conversation snapshot's `tool-call` chat nodes — no host listener, no polling for it, replay-stable from the durable log.

The browser plugin body is `apply`/`inject` only; controller, trace projection, and components stay internal to the `src/client` subpath.

## Model Experience

This package is browser presentation only: it reads the session conversation snapshot and the `skill.list` RPC, and it neither reaches a model request nor changes the session log. No model tokens, no KV cache effect.

## Known Limitations and Deferred Work

- **Catalog bodies for never-loaded skills are unavailable** — the `skill.list` RPC exposes `{name, description, whenToUse, modelInvocable}` only; full instruction content exists in the transcript once the model loads the skill. Until a skill loads, an expanded catalog row shows `whenToUse` or a hint instead of the body.
- **The sidebar replaces the workspace browser** — registering into the single `sidebar` seat shadows the shipped workspace/session browsing region and its settings rail; the same holds for `details` and the tool-details panel. Removing the `banma-skills-workbench` roster row from `packages/bundle/web-app/cordis.patch.yml` restores the shipped columns.
- **Trace rows appear only while the call is in the runtime window** — the trace projects chat nodes, so history pagination that evicts a call drops its row from the panel (the transcript still owns the durable record).
- **No component/controller test suite yet** — `src/client/trace.ts` has unit coverage; the controller and both panels still need specs to satisfy the per-file coverage gate.
