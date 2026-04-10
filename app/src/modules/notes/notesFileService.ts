import { writeFile, listFolder } from '../files/service'

export type NoteFile = {
  name: string      // e.g. "我的随笔.md" or "2026-04-09_15-30-22.md"
  path: string      // full absolute path
  createdAt: Date   // parsed from filename (date-named files only); new Date(0) for title-named
}

/** 生成时间戳兜底文件名：YYYY-MM-DD_HH-mm-ss.md */
export function generateNoteFilename(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const MM = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const HH = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `${yyyy}-${MM}-${dd}_${HH}-${mm}-${ss}.md`
}

/** 清理标题，使其成为合法文件名（去除非法字符，最长 80 字符） */
function sanitizeFilename(title: string): string {
  return title
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/**
 * 在已有文件名集合中解析不重复的文件名。
 * 重复时追加数字：base.md → base1.md → base2.md …
 */
function resolveUniqueFilename(existingNames: Set<string>, base: string): string {
  if (!existingNames.has(`${base}.md`)) return `${base}.md`
  let i = 1
  while (existingNames.has(`${base}${i}.md`)) i++
  return `${base}${i}.md`
}

/**
 * 在指定目录创建随笔文件，返回完整文件路径。
 * @param title 可选标题 — 用于文件命名；未提供时以时间戳命名
 */
export async function createNote(dir: string, content = '', title?: string): Promise<string> {
  let filename: string
  if (title) {
    const base = sanitizeFilename(title) || generateNoteFilename().replace('.md', '')
    // 获取目录现有文件名以解决冲突
    const listResult = await listFolder(dir)
    const existingNames = new Set(
      listResult.ok ? listResult.data.map((e) => e.name) : [],
    )
    filename = resolveUniqueFilename(existingNames, base)
  } else {
    filename = generateNoteFilename()
  }

  const path = `${dir}/${filename}`
  const result = await writeFile({ path, content })
  if (!result.ok) {
    throw new Error(result.error?.message ?? 'Failed to write note file')
  }
  return path
}

/** 列出目录中的所有随笔（.md 文件）
 *  排序：时间戳命名文件按日期倒序（最新在前），标题命名文件按字母顺序置于其后
 */
export async function listNotes(dir: string): Promise<NoteFile[]> {
  const result = await listFolder(dir)
  if (!result.ok) {
    throw new Error(result.error?.message ?? 'Failed to list notes directory')
  }
  return result.data
    .filter((entry) => !entry.name.endsWith('/') && entry.name.endsWith('.md'))
    .map((entry) => ({
      name: entry.name,
      path: entry.path,
      createdAt: parseNoteDate(entry.name),
    }))
    .sort((a, b) => {
      const aIsDate = a.createdAt.getTime() !== 0
      const bIsDate = b.createdAt.getTime() !== 0
      if (aIsDate && bIsDate) return b.createdAt.getTime() - a.createdAt.getTime()
      if (aIsDate) return -1
      if (bIsDate) return 1
      return a.name.localeCompare(b.name)
    })
}

/** 解析随笔文件名中的时间戳 "YYYY-MM-DD_HH-mm-ss.md" → Date（标题命名文件返回 new Date(0)） */
function parseNoteDate(filename: string): Date {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})/)
  if (!m) return new Date(0)
  return new Date(`${m[1]}T${m[2].replace(/-/g, ':')}`)
}
