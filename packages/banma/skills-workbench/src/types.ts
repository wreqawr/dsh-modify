/**
 * Wire vocabulary of the skills-workbench file-tree Remote domain. Types
 * only — no runtime code lives here.
 * @module @deepseek-ai/dsh-banma-skills-workbench/types
 */

/** One row of a directory listing. */
export interface TreeEntry {
  /** Base name (never a path). */
  name: string
  /** Absolute host path. */
  path: string
  /** Whether the row is a directory (files render as leaves). */
  isDirectory: boolean
}

/** List one directory level. */
export interface ListDirRequest {
  /** Absolute directory to list. */
  path: string
}

/** ListDir response: the listed directory plus its direct children. */
export interface ListDirResult {
  /** Absolute path of the listed directory. */
  path: string
  /** Direct children, directories first then files, each name-ordered. */
  entries: TreeEntry[]
}

/** Create one child directory under an existing parent. */
export interface CreateFolderRequest {
  /** Absolute existing parent directory. */
  path: string
  /** Single non-blank path segment. */
  name: string
}

/** CreateFolder response: the created directory's absolute path. */
export interface CreateFolderResult {
  path: string
}

/** Delete one file or directory (recursively). */
export interface RemovePathRequest {
  /** Absolute target path. */
  path: string
}

/** Create or overwrite one file with text or base64 content. */
export interface WriteFileRequest {
  /** Absolute target file path. */
  path: string
  /** Content; UTF-8 text by default, base64 when `encoding` is `base64`. */
  content: string
  /** Content encoding; defaults to `utf8`. */
  encoding?: 'utf8' | 'base64'
}

/** Read one text file for preview. */
export interface ReadFileRequest {
  /** Absolute target file path. */
  path: string
}

/** ReadFile response: the file's UTF-8 text (bounded by the preview limit). */
export interface ReadFileResult {
  /** Absolute path of the read file. */
  path: string
  /** UTF-8 text content. */
  content: string
}
