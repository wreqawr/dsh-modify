/**
 * Sidebar workspace directory tree: a VSCode-style explorer rooted at the
 * current session's workspace `cwd`, with right-click actions to create
 * folders/files, upload browser files, and delete rows. Expansion is lazy —
 * each directory lists one level through the host `skillsWorkbench` Remote
 * domain the first time it opens — and the root re-derives whenever the
 * chat's selected session (and therefore its workspace) changes.
 * @module @deepseek-ai/dsh-client-banma-skills-workbench/client/DirectoryTree
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { FileTreeActions, TreeEntry } from './workbench.ts'
import css from './SkillsWorkbench.module.css'

/** One directory level: its listing, a loading marker, or a load failure. */
type DirContent = readonly TreeEntry[] | 'loading' | 'error'

/** Rows hidden by default so the tree stays navigable in a vendored checkout. */
const HIDDEN_NAMES = new Set(['.git', 'node_modules', '.DS_Store'])

/** Absolute parent of a path (client-side, for sibling creation). */
function parentOf(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index <= 0 ? path : path.slice(0, index)
}

/** Trailing path segment (the workspace label). */
function baseOf(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index === -1 ? path : path.slice(index + 1)
}

/** Right-click menu placement and target. */
interface ContextMenuState {
  x: number
  y: number
  path: string
  isDirectory: boolean
}

/** Inline creation input target. */
interface CreateInputState {
  parent: string
  kind: 'folder' | 'file'
}

/** Directory-tree props: the workspace root and the file-tree actions. */
export interface DirectoryTreeProps {
  /** Current workspace root; `undefined` while no session is current. */
  root: string | undefined
  /** File-tree actions wired in the plugin body. */
  fileTree: FileTreeActions
  /** Preview one file in the details column. */
  onPreview: (path: string) => void
}

/**
 * Render the workspace directory tree.
 * @param props - workspace root, file-tree actions, and the preview opener.
 * @returns the tree element tree.
 */
export function DirectoryTree({ root, fileTree, onPreview }: DirectoryTreeProps) {
  const [rootContent, setRootContent] = useState<DirContent | null>(null)
  const [dirs, setDirs] = useState<ReadonlyMap<string, DirContent>>(new Map())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [creating, setCreating] = useState<CreateInputState | null>(null)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [treeNote, setTreeNote] = useState<string | null>(null)
  const [upload, setUpload] = useState<{ dir: string; directory: boolean } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dirInputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const noteTimerRef = useRef<number | null>(null)

  const showNote = (text: string): void => {
    if (noteTimerRef.current !== null) window.clearTimeout(noteTimerRef.current)
    setTreeNote(text)
    noteTimerRef.current = window.setTimeout(() => setTreeNote(null), 3000)
  }

  // The target rides state so the onChange closure always reads the correct
  // directory; the picker opens only after the fresh input is committed.
  useEffect(() => {
    if (upload === null) return
    const ref = upload.directory ? dirInputRef : fileInputRef
    ref.current?.click()
  }, [upload])

  // Re-root the tree whenever the chat's selected workspace changes.
  useEffect(() => {
    setRootContent(null)
    setDirs(new Map())
    setExpanded(new Set())
    setMenu(null)
    setCreating(null)
    setTreeError(null)
    if (root === undefined) return
    let alive = true
    setRootContent('loading')
    fileTree.listDir(root).then((result) => {
      if (!alive) return
      if (result.error === undefined) {
        setRootContent(result.value ?? [])
      } else {
        setRootContent('error')
        setTreeError(result.error)
      }
    })
    return () => {
      alive = false
    }
  }, [root, fileTree])

  // Dismiss the context menu on any outside pointer press or Escape.
  useEffect(() => {
    if (menu === null) return
    const onPointerDown = (event: PointerEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) setMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])

  const applyDirResult = (path: string, result: { value?: TreeEntry[]; error?: string }): void => {
    setDirs((prev) => {
      const next = new Map(prev)
      next.set(path, result.error === undefined ? (result.value ?? []) : 'error')
      return next
    })
    if (result.error !== undefined) setTreeError(result.error)
  }

  const loadDir = (path: string): void => {
    setDirs((prev) => {
      if (prev.has(path)) return prev
      const next = new Map(prev)
      next.set(path, 'loading')
      return next
    })
    fileTree.listDir(path).then(result => applyDirResult(path, result))
  }

  const reloadDir = (path: string): void => {
    setDirs((prev) => {
      const next = new Map(prev)
      next.set(path, 'loading')
      return next
    })
    fileTree.listDir(path).then(result => applyDirResult(path, result))
  }

  const refreshDir = (path: string): void => {
    if (path === root) {
      setRootContent('loading')
      fileTree.listDir(path).then((result) => {
        if (result.error === undefined) setRootContent(result.value ?? [])
        else setTreeError(result.error)
      })
    } else if (dirs.has(path)) {
      reloadDir(path)
    }
  }

  const toggleDir = (path: string): void => {
    const next = new Set(expanded)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
      if (!dirs.has(path)) loadDir(path)
    }
    setExpanded(next)
  }

  const commitCreate = async (name: string): Promise<void> => {
    if (creating === null) return
    const { parent, kind } = creating
    const trimmed = name.trim()
    setCreating(null)
    if (trimmed === '') return
    const result = kind === 'folder'
      ? await fileTree.createFolder(parent, trimmed)
      : await fileTree.createFile(`${parent}/${trimmed}`, '')
    if (result.error !== undefined) {
      setTreeError(result.error)
      return
    }
    refreshDir(parent)
  }

  const deleteRow = async (path: string): Promise<void> => {
    const label = baseOf(path)
    if (!window.confirm(`确定删除 ${label} 吗？此操作不可撤销。`)) return
    setMenu(null)
    const result = await fileTree.removePath(path)
    if (result.error !== undefined) {
      setTreeError(result.error)
      return
    }
    refreshDir(parentOf(path))
  }

  const openMenu = (event: React.MouseEvent, path: string, isDirectory: boolean): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, path, isDirectory })
  }

  const requestUpload = (dir: string, directory: boolean): void => {
    setMenu(null)
    setUpload({ dir, directory })
  }

  const onUploadChange = async (event: React.ChangeEvent<HTMLInputElement>, dir: string): Promise<void> => {
    const files = event.target.files
    console.log('[banma] upload onChange fired:', { dir, count: files?.length ?? 0 })
    if (files === null || files.length === 0) return
    try {
      const result = await fileTree.uploadFiles(dir, Array.from(files))
      console.log('[banma] upload result:', result)
      if (result.uploaded > 0 && result.failed.length === 0) {
        showNote(`已上传 ${result.uploaded} 个文件`)
      } else if (result.failed.length > 0) {
        setTreeError(result.failed.join('；'))
      }
    } catch (error) {
      console.error('banma-skills-workbench: upload failed:', error)
      setTreeError(`上传失败: ${error instanceof Error ? error.message : String(error)}`)
    }
    setUpload(null)
    refreshDir(dir)
  }

  const renderChildren = (content: DirContent | null, path: string, depth: number): ReactNode[] => {
    const rows: ReactNode[] = []
    const pad = depth * 18 + 14
    if (content === 'loading') {
      rows.push(<div key="loading" className={css.treeHint} style={{ paddingLeft: pad }}>加载中…</div>)
    } else if (content === 'error') {
      rows.push(<div key="error" className={css.treeHint} style={{ paddingLeft: pad }}>加载失败</div>)
    } else if (content !== null) {
      for (const entry of content) {
        if (HIDDEN_NAMES.has(entry.name)) continue
        rows.push(renderEntry(entry, depth))
      }
    }
    if (creating !== null && creating.parent === path) {
      rows.push(
        <div key="create" className={css.treeCreateRow} style={{ paddingLeft: pad }}>
          <input
            autoFocus
            className={css.treeCreateInput}
            placeholder={creating.kind === 'folder' ? '文件夹名' : '文件名'}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void commitCreate(event.currentTarget.value)
              if (event.key === 'Escape') setCreating(null)
            }}
            onBlur={() => setCreating(null)}
          />
        </div>,
      )
    }
    return rows
  }

  const renderEntry = (entry: TreeEntry, depth: number): ReactNode => {
    const pad = depth * 18 + 12
    if (entry.isDirectory) {
      const open = expanded.has(entry.path)
      return (
        <div key={entry.path}>
          <div
            className={css.treeRow}
            style={{ paddingLeft: pad }}
            onClick={() => toggleDir(entry.path)}
            onContextMenu={event => openMenu(event, entry.path, true)}
          >
            <span className={css.treeChevron}>{open ? '▾' : '▸'}</span>
            <span className={css.treeIcon}>{open ? '📂' : '📁'}</span>
            <span className={css.treeName}>{entry.name}</span>
          </div>
          {open ? renderChildren(dirs.get(entry.path) ?? null, entry.path, depth + 1) : null}
        </div>
      )
    }
    return (
      <div
        key={entry.path}
        className={css.treeRow}
        style={{ paddingLeft: pad + 12 }}
        onClick={() => onPreview(entry.path)}
        onContextMenu={event => openMenu(event, entry.path, false)}
      >
        <span className={css.treeIcon}>📄</span>
        <span className={css.treeName}>{entry.name}</span>
      </div>
    )
  }

  const menuParent = menu === null ? null : menu.isDirectory ? menu.path : parentOf(menu.path)
  const menuOnRoot = menu !== null && menu.path === root

  return (
    <div className={css.tree} onContextMenu={(event) => {
      if (root !== undefined) openMenu(event, root, true)
    }}>
      {root === undefined ? (
        <div className={css.empty}>当前无会话工作区，选择工作区后显示目录树。</div>
      ) : (
        <>
          <div className={css.treeRootActions}>
            <button
              type="button"
              className={css.treeRootAction}
              onClick={() => setCreating({ parent: root, kind: 'folder' })}
            >
              ＋ 文件夹
            </button>
            <button
              type="button"
              className={css.treeRootAction}
              onClick={() => setCreating({ parent: root, kind: 'file' })}
            >
              ＋ 文件
            </button>
            <button type="button" className={css.treeRootAction} onClick={() => requestUpload(root, false)}>
              上传文件
            </button>
            <button type="button" className={css.treeRootAction} onClick={() => requestUpload(root, true)}>
              上传文件夹
            </button>
          </div>
          {rootContent === null ? null : renderChildren(rootContent, root, 0)}
        </>
      )}
      {menu !== null ? (
        <div ref={menuRef} className={css.treeMenu} style={{ left: menu.x, top: menu.y }} onClick={() => setMenu(null)}>
          <button type="button" className={css.treeMenuItem} onClick={() => { setMenu(null); setCreating({ parent: menuParent ?? menu.path, kind: 'folder' }) }}>
            新建文件夹
          </button>
          <button type="button" className={css.treeMenuItem} onClick={() => { setMenu(null); setCreating({ parent: menuParent ?? menu.path, kind: 'file' }) }}>
            新建文件
          </button>
          <button type="button" className={css.treeMenuItem} onClick={() => requestUpload(menuParent ?? menu.path, false)}>
            上传文件
          </button>
          <button type="button" className={css.treeMenuItem} onClick={() => requestUpload(menuParent ?? menu.path, true)}>
            上传文件夹
          </button>
          {!menuOnRoot ? (
            <button type="button" className={css.treeMenuItem} onClick={() => void deleteRow(menu.path)}>
              删除
            </button>
          ) : null}
        </div>
      ) : null}
      {upload !== null && !upload.directory ? (
        <input
          key={`files-${upload.dir}`}
          ref={fileInputRef}
          type="file"
          multiple
          className={css.treeFileInput}
          onChange={event => void onUploadChange(event, upload.dir)}
        />
      ) : null}
      {upload !== null && upload.directory ? (
        <input
          key={`dirs-${upload.dir}`}
          ref={dirInputRef}
          type="file"
          multiple
          {...{ directory: '', webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>}
          className={css.treeFileInput}
          onChange={event => void onUploadChange(event, upload.dir)}
        />
      ) : null}
      {treeNote !== null ? <div className={css.treeNote}>{treeNote}</div> : null}
      {treeError !== null ? <div className={css.treeError}>{treeError}</div> : null}
    </div>
  )
}
