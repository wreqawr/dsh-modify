/**
 * Apply-world workbench controller: one snapshot store both panels read
 * through the inject `hooks` compartment, fed by subscriptions the plugin
 * owns (the current-session feed, that session's conversation face) and by
 * the read-only connection `skill.list` RPC. Components stay subscription
 * free: they read `useSkillsWorkbench` and derive views with `useMemo`.
 * @module @deepseek-ai/dsh-client-banma-skills-workbench/client/workbench
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import {
  createSnapshotStore,
  type ConversationSnapshot,
  type ISessions,
  type SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** One row of the connection `skill.list` catalog. */
export interface CatalogEntry {
  name: string
  description: string
  whenToUse?: string
  modelInvocable: boolean
}

/** Shared state published to both workbench panels. */
export interface WorkbenchState {
  /** Session the panels address (the list's current selection). */
  currentId: SessionId | undefined
  /** Live conversation of that session, or `undefined` before one exists. */
  conversation: ConversationSnapshot | undefined
  /** Settled catalog, or `null` while none is loaded. */
  catalog: readonly CatalogEntry[] | null
  /** Catalog load failure, else `null`. */
  catalogError: string | null
  /** Active file preview (shown in the details column), or `null`. */
  preview: FilePreview | null
}

/** One file preview shown in the details column. */
export interface FilePreview {
  /** Absolute file path. */
  path: string
  /** UTF-8 text content, or `''` when `error` is set. */
  content: string
  /** Read failure text, else absent. */
  error?: string
}

/** One row of a workspace directory listing. */
export interface TreeEntry {
  name: string
  path: string
  isDirectory: boolean
}

/** Result of a file-tree mutation; `value` present exactly when `error` is absent. */
export interface FileTreeResult<T> {
  value?: T
  error?: string
}

/** File-tree operations wired to the host `skillsWorkbench` Remote domain. */
export interface FileTreeActions {
  /** List one directory level. */
  listDir: (path: string) => Promise<FileTreeResult<TreeEntry[]>>
  /** Create a folder under a parent directory. */
  createFolder: (parent: string, name: string) => Promise<FileTreeResult<string>>
  /** Create or overwrite a text file at an absolute path. */
  createFile: (path: string, content: string) => Promise<FileTreeResult<string>>
  /** Delete a file or directory tree. */
  removePath: (path: string) => Promise<FileTreeResult<true>>
  /** Upload browser files (base64) into a directory. */
  uploadFiles: (dir: string, files: readonly File[]) => Promise<{ uploaded: number; failed: readonly string[] }>
  /** Read one file's text for preview. */
  readFile: (path: string) => Promise<FileTreeResult<string>>
}

/** Panel actions threaded through the inject face. */
export interface WorkbenchActions {
  /** Toggle the sidebar column (rail/wide). */
  toggleSidebar: () => void
  /** Open the right details column. */
  openDetails: () => void
  /** Close the right details column. */
  closeDetails: () => void
  /** Re-fetch the skill catalog now. */
  refresh: () => void
  /** Start a new session in the current (or most recent) workspace. */
  newSession: () => void
  /** Pick an existing directory and register it as a workspace. */
  newWorkspace: () => Promise<void>
  /** File-tree operations for the sidebar tree. */
  fileTree: FileTreeActions
  /** Read and show a file preview in the details column. */
  openPreview: (path: string) => Promise<void>
  /** Clear the active file preview (back to the trace). */
  closePreview: () => void
}

/** Inject face shared by both workbench registrations. */
export interface SkillsWorkbenchInjected {
  /** Shared workbench store bound by the renderer as `useSkillsWorkbench`. */
  hooks: {
    skillsWorkbench: SnapshotStore<WorkbenchState>
  }
  /** Panel actions wired in the plugin body. */
  actions: WorkbenchActions
}

const INITIAL: WorkbenchState = {
  currentId: undefined,
  conversation: undefined,
  catalog: null,
  catalogError: null,
  preview: null,
}

/** Catalog refresh cadence while a panel is mounted (the host forwards no skill-change event). */
const CATALOG_REFRESH_MS = 15000

/**
 * Owns the workbench store and its external subscriptions. The controller is
 * apply-world only; it lives and dies with the plugin fiber via the disposer
 * `start()` returns.
 */
export class WorkbenchController {
  readonly store: SnapshotStore<WorkbenchState> = createSnapshotStore<WorkbenchState>(INITIAL)

  private readonly sessions: ISessions
  private readonly api: ConnectionHandle['api']
  private unbindConversation: (() => void) | null = null
  private timer: number | null = null

  /**
   * @param sessions - the client sessions service (list feed + per-session binding).
   * @param api - the connection API face exposing `skill.list`.
   */
  constructor(sessions: ISessions, api: ConnectionHandle['api']) {
    this.sessions = sessions
    this.api = api
  }

  /**
   * Subscribe to the current-session feed, bind the conversation face, and
   * arm the catalog refresh cadence.
   * @returns the fiber disposer unwinding every subscription.
   */
  start(): () => void {
    const offList = this.sessions.list.subscribe(() => this.onCurrentChange())
    this.onCurrentChange()
    this.timer = window.setInterval(() => this.fetchCatalog(), CATALOG_REFRESH_MS)
    return () => {
      offList()
      if (this.unbindConversation !== null) this.unbindConversation()
      if (this.timer !== null) window.clearInterval(this.timer)
    }
  }

  /** Re-fetch the catalog immediately (the panel refresh action). */
  refresh(): void {
    this.fetchCatalog()
  }

  /** Set the active file preview, or clear it with `null`. */
  setPreview(preview: FilePreview | null): void {
    this.store.update((snapshot) => {
      snapshot.preview = preview
    })
  }

  private onCurrentChange(): void {
    const current = this.sessions.list.getSnapshot().current
    const state = this.store.getSnapshot()
    if (state.currentId === current) return
    if (this.unbindConversation !== null) {
      this.unbindConversation()
      this.unbindConversation = null
    }
    this.store.update((snapshot) => {
      snapshot.currentId = current
      snapshot.conversation = undefined
      snapshot.catalog = null
      snapshot.catalogError = null
      snapshot.preview = null
    })
    if (current === undefined) return
    const face = this.sessions.binding(current)?.session
    if (face === undefined) return
    this.unbindConversation = face.subscribe(() => {
      this.store.update((snapshot) => {
        snapshot.conversation = face.getSnapshot()
      })
    })
    this.store.update((snapshot) => {
      snapshot.conversation = face.getSnapshot()
    })
    this.fetchCatalog()
  }

  private async fetchCatalog(): Promise<void> {
    const current = this.store.getSnapshot().currentId
    if (current === undefined) {
      this.store.update((snapshot) => {
        snapshot.catalog = null
        snapshot.catalogError = null
      })
      return
    }
    try {
      const { result } = await this.api.skills.list({ sessionId: current })
      if (this.store.getSnapshot().currentId !== current) return
      if (result.ok) {
        this.store.update((snapshot) => {
          snapshot.catalog = [...result.value.skills]
          snapshot.catalogError = null
        })
      } else {
        this.store.update((snapshot) => {
          snapshot.catalog = null
          snapshot.catalogError = `skill.list: ${result.error.code}: ${result.error.message}`
        })
      }
    } catch (error) {
      if (this.store.getSnapshot().currentId !== current) return
      this.store.update((snapshot) => {
        snapshot.catalogError = error instanceof Error ? error.message : String(error)
      })
    }
  }
}
