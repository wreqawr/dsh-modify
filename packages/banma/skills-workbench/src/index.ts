/**
 * Skills-workbench file-tree Remote service: directory listing and
 * file/folder mutation primitives over node fs, served to the browser through
 * the typert gateway (`ctx.remote.skillsWorkbench`). The client always sends
 * absolute paths derived from the selected workspace `cwd`; the service
 * rejects non-absolute wire values rather than resolving them against the
 * host working directory.
 * @module @deepseek-ai/dsh-banma-skills-workbench
 */

import { Context } from '@deepseek-ai/cordis'
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  CreateFolderRequest,
  CreateFolderResult,
  ListDirRequest,
  ListDirResult,
  ReadFileRequest,
  ReadFileResult,
  RemovePathRequest,
  WriteFileRequest,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The skills-workbench file-tree service. */
    skillsWorkbench: SkillsWorkbenchService
  }
}

/** Reject a wire path that is not absolute. */
function requireAbsolute(path: string, subject: string): void {
  if (!isAbsolute(path)) throw new Error(`skillsWorkbench: ${subject} must be an absolute path`)
}

/** Reject a name that is not a single plain path segment. */
function requireSegment(name: string, subject: string): void {
  if (name === '' || name === '.' || name === '..' || /[/\\]/.test(name)) {
    throw new Error(`skillsWorkbench: ${subject} must be a single non-blank path segment`)
  }
}

/** VSCode-style order: directories first, then files, each name-ordered. */
function compareRows(a: { name: string; isDirectory: boolean }, b: { name: string; isDirectory: boolean }): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

/**
 * File-tree operations over the host filesystem, addressable by the browser
 * through the generated `skillsWorkbench` Remote namespace.
 */
export class SkillsWorkbenchService extends TypertRemoteService {
  /**
   * @param ctx - host context (the service registers under `skillsWorkbench`).
   */
  constructor(ctx: Context) {
    super(ctx, 'skillsWorkbench')
  }

  /**
   * List one directory level.
   * @param request - absolute directory to list.
   * @returns the level's direct children, directories first.
   */
  @Remote('listDir')
  async listDir(request: ListDirRequest): Promise<ListDirResult> {
    requireAbsolute(request.path, 'listDir path')
    const target = resolve(request.path)
    const dirents = await fs.readdir(target, { withFileTypes: true })
    const entries = dirents
      .map(dirent => ({ name: dirent.name, path: join(target, dirent.name), isDirectory: dirent.isDirectory() }))
      .sort(compareRows)
    return { path: target, entries }
  }

  /**
   * Create one child directory under an existing parent.
   * @param request - absolute parent and a single-segment name.
   * @returns the created directory's absolute path.
   */
  @Remote('createFolder')
  async createFolder(request: CreateFolderRequest): Promise<CreateFolderResult> {
    requireAbsolute(request.path, 'createFolder parent path')
    requireSegment(request.name, 'createFolder name')
    const target = join(resolve(request.path), request.name)
    await fs.mkdir(target, { recursive: false })
    return { path: target }
  }

  /**
   * Delete one file or directory tree.
   * @param request - absolute target path.
   * @returns a fixed acknowledgement.
   */
  @Remote('removePath')
  async removePath(request: RemovePathRequest): Promise<{ removed: true }> {
    requireAbsolute(request.path, 'removePath path')
    const target = resolve(request.path)
    await fs.rm(target, { recursive: true })
    return { removed: true }
  }

  /**
   * Create or overwrite one file.
   * @param request - absolute target path, content, and optional encoding.
   * @returns the written file's absolute path.
   */
  @Remote('writeFile')
  async writeFile(request: WriteFileRequest): Promise<{ path: string }> {
    requireAbsolute(request.path, 'writeFile path')
    const target = resolve(request.path)
    const encoding: 'utf8' | 'base64' = request.encoding === 'base64' ? 'base64' : 'utf8'
    // Recursive parents let a directory upload write every nested file without
    // a separate createFolder round-trip per level.
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.writeFile(target, request.content, encoding)
    return { path: target }
  }

  /**
   * Read one file for the sidebar preview pane, bounded to the preview limit.
   * @param request - absolute target file path.
   * @returns the file's UTF-8 text.
   */
  @Remote('readFile')
  async readFile(request: ReadFileRequest): Promise<ReadFileResult> {
    requireAbsolute(request.path, 'readFile path')
    const target = resolve(request.path)
    const stat = await fs.stat(target)
    if (!stat.isFile()) throw new Error('skillsWorkbench: readFile target is not a file')
    if (stat.size > READ_PREVIEW_MAX_BYTES) {
      throw new Error(`skillsWorkbench: file too large to preview (${stat.size} bytes)`)
    }
    const content = await fs.readFile(target, 'utf8')
    return { path: target, content }
  }
}

/** Upper bound for one sidebar file preview, keeping the wire payload small. */
const READ_PREVIEW_MAX_BYTES = 200 * 1024

export default SkillsWorkbenchService
