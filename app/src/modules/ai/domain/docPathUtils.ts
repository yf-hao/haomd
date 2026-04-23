import { normalizePersistableFilePath } from '../../files/filePathState'

export function normalizePersistableDocPath(docPath?: string | null): string | undefined {
  return normalizePersistableFilePath(docPath) ?? undefined
}

export function getDirKeyFromDocPath(docPath?: string | null): string | undefined {
  const normalized = normalizePersistableDocPath(docPath)
  if (!normalized) return undefined

  const idx = normalized.lastIndexOf('/')
  // 严格模式：仅使用本目录作为 key，不向上合并父目录，也不包含子目录
  // - 绝对路径如 "/Users/me/notes/todo.md" → "/Users/me/notes"
  // - 相对路径如 "notes/todo.md" → "notes"
  // - 根目录下文件如 "/todo.md" 或 "todo.md" 统一视作根目录会话
  if (idx <= 0) {
    // 将整个工作区根视为一个特殊目录 key
    return '/'
  }

  return normalized.slice(0, idx)
}
