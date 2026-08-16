/**
 * Skills workbench plugin, browser half: replaces the left sidebar with the
 * skill catalog, the activated skills' system prompts, a workspace directory
 * tree, and new-session/new-workspace actions; the right details column shows
 * the live skill-execution trace. Panels read one shared workbench store
 * (inject `hooks`) fed by apply-world subscriptions — the current-session
 * feed, that session's conversation face, and the read-only connection
 * `skill.list` RPC. The trace is a pure projection of the conversation
 * snapshot; the directory tree rides the `skillsWorkbench` Remote domain.
 * @module @deepseek-ai/dsh-client-banma-skills-workbench/client
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the api-remotes assembly so `ctx.remote.skillsWorkbench` resolves.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { SkillsPanel } from './SkillsPanel.tsx'
import { TracePanel } from './TracePanel.tsx'
import {
  WorkbenchController,
  type FileTreeActions,
  type SkillsWorkbenchInjected,
  type WorkbenchActions,
} from './workbench.ts'

/** Required services: slot registration, sessions/workspaces, the connection RPC, layout, and the file-tree Remote. */
export const inject = ['slots', 'sessions', 'connection', 'layout', 'workspaces', 'remote', 'remote.skillsWorkbench']

/** Read a browser file as a base64 string (without the data-URL prefix). */
function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '')
      const comma = dataUrl.indexOf(',')
      resolve(comma === -1 ? dataUrl : dataUrl.slice(comma + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'))
    reader.readAsDataURL(file)
  })
}

/**
 * Mount the two workbench registrations and their shared controller.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const slots = ctx.get('slots')
  if (slots === undefined) return
  const sessions = ctx.get('sessions') as ClientContext['sessions'] | undefined
  const workspaces = ctx.get('workspaces') as IWorkspaces | undefined
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  if (sessions === undefined || connection === undefined) return
  const layout = ctx.get('layout')
  const treeRemote = ctx.remote.skillsWorkbench

  const controller = new WorkbenchController(sessions, connection.api)
  ctx.effect(() => controller.start(), 'banma-skills-workbench: controller')

  const errText = (result: { ok: false; error: { code: string; message: string } }): string =>
    `${result.error.code}: ${result.error.message}`

  const fileTree: FileTreeActions = {
    listDir: async (path) => {
      const result = await treeRemote.listDir({ path })
      return result.ok ? { value: result.value.entries } : { error: errText(result) }
    },
    createFolder: async (parent, name) => {
      const result = await treeRemote.createFolder({ path: parent, name })
      return result.ok ? { value: result.value.path } : { error: errText(result) }
    },
    createFile: async (path, content) => {
      const result = await treeRemote.writeFile({ path, content })
      return result.ok ? { value: result.value.path } : { error: errText(result) }
    },
    removePath: async (path) => {
      const result = await treeRemote.removePath({ path })
      return result.ok ? { value: true } : { error: errText(result) }
    },
    uploadFiles: async (dir, files) => {
      let uploaded = 0
      const failed: string[] = []
      for (const file of files) {
        try {
          // Directory uploads carry the nested relative path on
          // webkitRelativePath; plain multi-file picks only have the basename.
          const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath
          const target = relative !== undefined && relative !== '' ? `${dir}/${relative}` : `${dir}/${file.name}`
          const content = await readFileBase64(file)
          const result = await treeRemote.writeFile({ path: target, content, encoding: 'base64' })
          if (result.ok) {
            uploaded += 1
          } else {
            failed.push(`${relative || file.name}: ${errText(result)}`)
          }
        } catch (error) {
          failed.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return { uploaded, failed }
    },
    readFile: async (path) => {
      const result = await treeRemote.readFile({ path })
      return result.ok ? { value: result.value.content } : { error: errText(result) }
    },
  }

  const actions: WorkbenchActions = {
    toggleSidebar: () => layout?.toggleSidebar(),
    openDetails: () => layout?.openDetails(),
    closeDetails: () => layout?.closeDetails(),
    refresh: () => controller.refresh(),
    newSession: () => workspaces?.startSession(),
    newWorkspace: async () => {
      if (workspaces === undefined) return
      try {
        const path = await workspaces.pickDirectory()
        if (path !== null) await workspaces.create({ path })
      } catch (error) {
        console.warn('new workspace failed:', error)
      }
    },
    fileTree,
    openPreview: async (path) => {
      const result = await fileTree.readFile(path)
      controller.setPreview(
        result.error === undefined
          ? { path, content: result.value ?? '' }
          : { path, content: '', error: result.error },
      )
      layout?.openDetails()
    },
    closePreview: () => controller.setPreview(null),
  }
  const injected = (): SkillsWorkbenchInjected => ({
    hooks: { skillsWorkbench: controller.store },
    actions,
  })

  // The shipped occupants register at priority 0; shadowing a single slot
  // requires a strictly lower priority (the dynamic runner's -1 convention).
  slots.inject('sidebar', () => slots.register({ name: 'sidebar', priority: -1, inject: injected }, SkillsPanel))
  slots.inject('details', () => slots.register({ name: 'details', priority: -1, inject: injected }, TracePanel))
}
