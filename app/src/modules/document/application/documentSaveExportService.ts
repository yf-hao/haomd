import { invoke } from '@tauri-apps/api/core'
import { dirname, documentDir } from '@tauri-apps/api/path'
import { normalizePersistableFilePath } from '../../files/filePathState'
import { writeFileNoRecent } from '../../files/service'
import { exportToWordAtPath, buildWordExportBaseName } from '../../export/word'
import { exportToHtmlAtPath } from '../../export/html'
import { getActiveWorkspaceDirectory } from '../../workspace/workspaceActiveDirectory'
import { getWorkspaceMountedRoots } from '../../workspace/workspaceMountedRoots'
import type { BackendResult } from '../../platform/backendTypes'

export type DocumentSaveFormat = 'md' | 'word' | 'html'
export type DocumentSaveTarget = 'current_file_dir' | 'workspace_directory'

export type SaveOrExportCurrentDocumentArgs = {
  format: DocumentSaveFormat
  target: DocumentSaveTarget
  targetDirectory?: string
  fileName?: string
}

export type DocumentSaveExportContext = {
  getCurrentMarkdown: () => string
  getCurrentFileName: () => string | null
  getCurrentFilePath?: () => string | null
  onDocumentSaved?: (path: string) => void
  setStatusMessage?: (message: string) => void
  t?: (key: string, params?: Record<string, string | number>) => string
}

type ResolveWorkspaceDirectoryResult =
  | {
    ok: true
    resolvedDirectory: string
  }
  | {
    ok: false
    reason: 'not_found' | 'ambiguous' | 'forbidden' | 'invalid_path'
    candidates?: string[]
  }

type CreateWorkspaceDirectoryResult =
  | {
    ok: true
    resolvedParentDirectory: string
    createdDirectoryPath: string
  }
  | {
    ok: false
    reason: 'not_found' | 'ambiguous' | 'forbidden' | 'invalid_path' | 'already_exists'
    candidates?: string[]
    createdDirectoryPath?: string
  }

type SaveOrExportCurrentDocumentResult =
  | { ok: true; savedFilePath: string }
  | { ok: false; message: string }

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/[\\/]+$/, '')
}

function joinPath(base: string, child: string): string {
  return `${normalizePath(base)}/${child.replace(/^\/+/, '')}`
}

function replaceExtension(fileName: string, extension: string): string {
  const base = buildWordExportBaseName(fileName)
  return `${base}.${extension}`
}

function getContainingMountedRoot(filePath: string | null | undefined, mountedRoots: string[]): string | null {
  if (!filePath) return null
  const normalizedFilePath = normalizePath(filePath)
  for (const root of mountedRoots) {
    const normalizedRoot = normalizePath(root)
    if (
      normalizedFilePath === normalizedRoot ||
      normalizedFilePath.startsWith(`${normalizedRoot}/`)
    ) {
      return normalizedRoot
    }
  }
  return null
}

async function getDefaultDirectoryForUnsavedDocument(): Promise<string | null> {
  const activeDirectory = getActiveWorkspaceDirectory()
  if (activeDirectory) {
    return normalizePath(activeDirectory)
  }

  try {
    const documentsDirectory = await documentDir()
    if (documentsDirectory?.trim()) {
      return normalizePath(documentsDirectory)
    }
  } catch (error) {
    console.warn('[documentSaveExportService] failed to resolve documentDir', error)
  }

  return null
}

async function resolveWorkspaceDirectory(targetDirectory: string): Promise<ResolveWorkspaceDirectoryResult> {
  const mountedRoots = getWorkspaceMountedRoots()
  const resp = await invoke<BackendResult<ResolveWorkspaceDirectoryResult>>(
    'resolve_workspace_directory',
    {
      mountedRoots,
      targetDirectory,
    },
  )

  if ('Err' in resp) {
    throw new Error(resp.Err.error.message || '解析工作区目录失败')
  }

  return resp.Ok.data
}

async function createWorkspaceDirectory(parentDirectory: string, directoryName: string): Promise<CreateWorkspaceDirectoryResult> {
  const mountedRoots = getWorkspaceMountedRoots()
  const resp = await invoke<BackendResult<CreateWorkspaceDirectoryResult>>(
    'create_workspace_directory',
    {
      mountedRoots,
      parentDirectory,
      directoryName,
    },
  )

  if ('Err' in resp) {
    throw new Error(resp.Err.error.message || '创建工作区目录失败')
  }

  return resp.Ok.data
}

async function ensureWorkspaceDirectoryExists(
  targetDirectory: string,
  currentFilePath: string | null,
): Promise<{ ok: true; resolvedDirectory: string } | { ok: false; message: string }> {
  const normalizedTarget = targetDirectory.trim()
  if (!normalizedTarget) {
    return { ok: false, message: '未提供目标工作区目录。' }
  }

  const resolved = await resolveWorkspaceDirectory(normalizedTarget)
  if (resolved.ok) {
    return { ok: true, resolvedDirectory: normalizePath(resolved.resolvedDirectory) }
  }

  if (resolved.reason === 'ambiguous') {
    const root = getContainingMountedRoot(currentFilePath, getWorkspaceMountedRoots())
    if (root && resolved.candidates?.length) {
      const scoped = resolved.candidates
        .map((candidate) => normalizePath(candidate))
        .filter((candidate) => candidate === root || candidate.startsWith(`${root}/`))
      if (scoped.length === 1) {
        return { ok: true, resolvedDirectory: scoped[0]! }
      }
    }
    return {
      ok: false,
      message: `目标目录存在歧义，请指定更完整的目录：${(resolved.candidates ?? []).join('、')}`,
    }
  }

  if (resolved.reason !== 'not_found') {
    if (resolved.reason === 'forbidden') {
      return { ok: false, message: '目标目录不在当前文件浏览器挂载目录树内。' }
    }
    return { ok: false, message: '目标目录无效。' }
  }

  const mountedRoots = getWorkspaceMountedRoots().map(normalizePath)
  const rootFromFile = getContainingMountedRoot(currentFilePath, mountedRoots)
  const baseRoot = rootFromFile ?? (mountedRoots.length === 1 ? mountedRoots[0]! : null)

  if (!baseRoot) {
    return {
      ok: false,
      message: '未找到目标目录，且当前存在多个工作区根目录。请先保存当前文档，或指定更完整的目录路径。',
    }
  }

  let currentPath = baseRoot
  for (const segment of normalizedTarget.split('/').map((part) => part.trim()).filter(Boolean)) {
    const created = await createWorkspaceDirectory(currentPath, segment)
    if (created.ok) {
      currentPath = normalizePath(created.createdDirectoryPath)
      continue
    }
    if (created.reason === 'already_exists' && created.createdDirectoryPath) {
      currentPath = normalizePath(created.createdDirectoryPath)
      continue
    }
    if (created.reason === 'ambiguous') {
      return {
        ok: false,
        message: `目标目录存在歧义，请指定更完整的目录：${(created.candidates ?? []).join('、')}`,
      }
    }
    if (created.reason === 'forbidden') {
      return { ok: false, message: '目标目录不在当前文件浏览器挂载目录树内。' }
    }
    return { ok: false, message: `创建目标目录失败：${segment}` }
  }

  return { ok: true, resolvedDirectory: currentPath }
}

function buildDefaultFileName(
  format: DocumentSaveFormat,
  fileName: string | null,
): string {
  const rawFileName = fileName?.trim() || 'Document.md'
  switch (format) {
    case 'md':
      return rawFileName.endsWith('.md') ? rawFileName : `${buildWordExportBaseName(rawFileName)}.md`
    case 'word':
      return replaceExtension(rawFileName, 'docx')
    case 'html':
      return replaceExtension(rawFileName, 'html')
  }
}

function buildRequestedFileName(
  format: DocumentSaveFormat,
  requestedFileName: string,
): string {
  const trimmed = requestedFileName.trim()
  switch (format) {
    case 'md':
      return trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`
    case 'word':
      return replaceExtension(trimmed, 'docx')
    case 'html':
      return replaceExtension(trimmed, 'html')
  }
}

function mapWriteFailureMessage(message: string | undefined, outputPath: string): string {
  const normalized = (message ?? '').trim()
  if (!normalized) {
    return `保存文件失败：${outputPath}`
  }

  const lowered = normalized.toLowerCase()
  if (
    lowered.includes('只读') ||
    lowered.includes('readonly') ||
    lowered.includes('read only') ||
    lowered.includes('不可写')
  ) {
    return `目标目录不可写，无法保存到：${outputPath}`
  }

  return `保存文件失败：${normalized}`
}

function resolveOutputFileName(
  format: DocumentSaveFormat,
  currentFileName: string | null,
  requestedFileName?: string,
): { ok: true; fileName: string } | { ok: false; message: string } {
  const trimmedRequested = requestedFileName?.trim()
  if (!trimmedRequested) {
    return { ok: true, fileName: buildDefaultFileName(format, currentFileName) }
  }

  if (/[\\/]/.test(trimmedRequested)) {
    return {
      ok: false,
      message: 'fileName 只能是文件名，不能包含目录分隔符。目录请通过 targetDirectory 指定。',
    }
  }

  return { ok: true, fileName: buildRequestedFileName(format, trimmedRequested) }
}

export async function saveOrExportCurrentDocument(
  args: SaveOrExportCurrentDocumentArgs,
  ctx: DocumentSaveExportContext,
): Promise<SaveOrExportCurrentDocumentResult> {
  const markdown = ctx.getCurrentMarkdown().trim()
  if (!markdown) {
    return { ok: false, message: '当前文档内容为空，无法保存或导出。' }
  }

  const currentFilePath = ctx.getCurrentFilePath ? ctx.getCurrentFilePath() : null
  const persistableCurrentFilePath = normalizePersistableFilePath(currentFilePath)
  const currentFileName = ctx.getCurrentFileName()
  const fileNameResult = resolveOutputFileName(args.format, currentFileName, args.fileName)
  if (!fileNameResult.ok) {
    return fileNameResult
  }
  const fileName = fileNameResult.fileName

  let targetDirectoryPath: string
  if (args.target === 'current_file_dir') {
    if (persistableCurrentFilePath) {
      targetDirectoryPath = normalizePath(await dirname(persistableCurrentFilePath))
    } else {
      const fallbackDirectory = await getDefaultDirectoryForUnsavedDocument()
      if (!fallbackDirectory) {
        return { ok: false, message: '当前文档尚未保存，且没有可用的激活目录或系统文档目录。' }
      }
      targetDirectoryPath = fallbackDirectory
    }
  } else {
    const resolved = await ensureWorkspaceDirectoryExists(
      args.targetDirectory?.trim() ?? '',
      persistableCurrentFilePath,
    )
    if (!resolved.ok) return resolved
    targetDirectoryPath = resolved.resolvedDirectory
  }

  const outputPath = joinPath(targetDirectoryPath, fileName)

  if (args.format === 'md') {
    const result = await writeFileNoRecent({
      path: outputPath,
      content: ctx.getCurrentMarkdown(),
    })
    if (!result.ok) {
      return { ok: false, message: mapWriteFailureMessage(result.error.message, outputPath) }
    }
    return { ok: true, savedFilePath: outputPath }
  }

  if (args.format === 'word') {
    const ok = await exportToWordAtPath(
      {
        getCurrentMarkdown: ctx.getCurrentMarkdown,
        getCurrentFileName: ctx.getCurrentFileName,
        getFilePath: ctx.getCurrentFilePath,
        setStatusMessage: ctx.setStatusMessage ?? (() => {}),
        t: ctx.t,
      },
      outputPath,
    )
    if (!ok) {
      return { ok: false, message: '导出 Word 失败。' }
    }
    return { ok: true, savedFilePath: outputPath }
  }

  const ok = await exportToHtmlAtPath(
    {
      getCurrentMarkdown: ctx.getCurrentMarkdown,
      getCurrentFileName: ctx.getCurrentFileName,
      getFilePath: ctx.getCurrentFilePath,
      setStatusMessage: ctx.setStatusMessage ?? (() => {}),
      t: ctx.t,
    },
    outputPath,
  )
  if (!ok) {
    return { ok: false, message: '导出 HTML 失败。' }
  }
  return { ok: true, savedFilePath: outputPath }
}
