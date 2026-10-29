import { decodeResourcePath, fileUrl } from './resourcePath'
export { fileUrl } from './resourcePath'
import { parse, postprocess, preprocess } from 'micromark'
import { decodeString } from 'micromark-util-decode-string'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { math } from 'micromark-extension-math'
import { relocateSrcset } from './relocateSrcset'

export type TextPatch = { from: number; to: number; insert: string }
export type FileRelocation = { oldPath: string; newPath: string }

export function sameFilePath(a: string, b: string): boolean {
  return fileUrl(a).href === fileUrl(b).href
}

/** Rebase local references by resource identity, including explicit self links. */
export function relocateUrl(value: string, documentPath: string, move: FileRelocation): string {
  if (!value || value.startsWith('#') || value.startsWith('?') || value.startsWith('//')) return value
  const windowsPath = /^[a-z]:[\\/]/i.test(value)
  if (!windowsPath && /^[a-z][a-z\d+.-]*:/i.test(value) && !/^file:/i.test(value)) return value
  let target: URL
  try { target = windowsPath ? fileUrl(value) : new URL(value.replace(/\\/g, '/'), fileUrl(documentPath)) }
  catch { return value }
  if (target.protocol !== 'file:') return value
  const old = fileUrl(move.oldPath)
  const next = fileUrl(move.newPath)
  const pointsToMovedFile = target.host === old.host && decodeResourcePath(target.pathname) === decodeResourcePath(old.pathname)
  if (pointsToMovedFile) {
    target.host = next.host
    target.pathname = next.pathname
  }
  const movedDocument = sameFilePath(documentPath, move.oldPath)
  if (!movedDocument && !pointsToMovedFile) return value
  if (/^file:/i.test(value)) return pointsToMovedFile ? target.href : value
  if (value.startsWith('/') || windowsPath) return pointsToMovedFile ? target.href : value
  const base = fileUrl(movedDocument ? move.newPath : documentPath)
  if (base.host !== target.host || /^\/[a-z]:\//i.test(base.pathname) &&
    base.pathname.slice(0, 3).toLowerCase() !== target.pathname.slice(0, 3).toLowerCase()) return target.href
  const from = base.pathname.split('/').slice(0, -1)
  const to = target.pathname.split('/')
  let common = 0
  while (common < from.length && common < to.length && from[common] === to[common]) common++
  let relative = [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/')
  if (!relative) relative = './'
  if (/^[^/]*:/.test(relative)) relative = './' + relative
  const rewritten = relative + target.search + target.hash
  // Preserve spelling/escaping when the original URL is still correct at the new base.
  if (new URL(value, base).href === target.href) return value
  return rewritten
}

function htmlPatches(raw: string, offset: number, rewrite: (url: string) => string, strict: boolean): TextPatch[] {
  const patches: TextPatch[] = []
  const root = parseFragment(raw, { sourceCodeLocationInfo: true })
  const walk = (node: DefaultTreeAdapterMap['node']) => {
    if ('attrs' in node) {
      if (strict && node.tagName === 'base') throw new Error('包含 HTML base 的文档暂不能安全移动')
      for (const attr of node.attrs) {
        if (!['src', 'href', 'poster', 'srcset'].includes(attr.name)) continue
        const location = node.sourceCodeLocation?.attrs?.[attr.name]
        if (!location) continue
        const attributeSource = raw.slice(location.startOffset, location.endOffset)
        const equals = attributeSource.indexOf('=')
        if (equals < 0) continue
        let start = equals + 1
        while (/\s/.test(attributeSource[start] ?? '') && start < attributeSource.length) start++
        const quoted = attributeSource[start] === '"' || attributeSource[start] === "'"
        if (quoted) start++
        const end = attributeSource.length - (quoted ? 1 : 0)
        let updated: string
        if (attr.name === 'srcset') {
          updated = relocateSrcset(attr.value, rewrite)
        } else updated = rewrite(attr.value)
        if (updated === attr.value) continue
        const escaped = updated.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
        patches.push({ from: offset + location.startOffset + start, to: offset + location.startOffset + end,
          insert: quoted ? escaped : `"${escaped}"` })
      }
    }
    if ('childNodes' in node) node.childNodes.forEach(walk)
    if ('content' in node) walk(node.content)
  }
  root.childNodes.forEach(walk)
  return patches
}

/** Concrete Markdown tokens give URL offsets without reserializing the document. */
export function planReferenceRelocation(markdown: string, documentPath: string, move: FileRelocation, strict = false): TextPatch[] {
  if (/\.txt$/i.test(documentPath)) return []
  // Every supported Markdown destination starts with [, or belongs to HTML/an
  // autolink starting with <. Plain prose needs no tokenization, including history.
  if (!markdown.includes('[') && !markdown.includes('<')) return []
  const frontMatter = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(markdown)?.[0] ?? ''
  const body = markdown.slice(frontMatter.length)
  const events = postprocess(parse({ extensions: [math()] }).document().write(preprocess()(body, 'utf8', true)))
  if (strict && /\.mdx$/i.test(documentPath)) {
    let searchable = body
    for (const [phase, token] of [...events].reverse()) {
      if (phase === 'enter' && ['codeFenced', 'codeIndented', 'codeText', 'mathFlow', 'mathText'].includes(token.type)) {
        searchable = searchable.slice(0, token.start.offset) + ' '.repeat(token.end.offset - token.start.offset) + searchable.slice(token.end.offset)
      }
    }
    if (/\b(?:src|href|poster|srcSet)\s*=\s*\{/i.test(searchable)) throw new Error('包含动态 MDX 资源地址的文档暂不能安全移动')
  }
  const patches: TextPatch[] = []
  const rewrite = (value: string) => relocateUrl(value, documentPath, move)
  for (const [phase, token] of events) {
    if (phase !== 'enter') continue
    const from = frontMatter.length + token.start.offset
    const to = frontMatter.length + token.end.offset
    if (token.type === 'resourceDestinationString' || token.type === 'definitionDestinationString' || token.type === 'autolinkProtocol') {
      const raw = markdown.slice(from, to)
      const decoded = decodeString(raw)
      const updated = rewrite(decoded)
      if (updated !== decoded) patches.push({ from, to,
        insert: updated.replace(/[()<>\s]/g, char => encodeURIComponent(char).replace('(', '%28').replace(')', '%29')).replace(/&/g, '&amp;') })
    } else if (token.type === 'htmlFlow' || token.type === 'htmlText') {
      patches.push(...htmlPatches(markdown.slice(from, to), from, rewrite, strict))
    }
  }
  return patches.sort((a, b) => a.from - b.from)
}

export function applyTextPatches(value: string, patches: TextPatch[]): string {
  let end = 0
  const parts: string[] = []
  for (const patch of patches) {
    if (patch.from < end || patch.to < patch.from || patch.to > value.length) throw new Error('引用补丁范围无效')
    parts.push(value.slice(end, patch.from), patch.insert)
    end = patch.to
  }
  parts.push(value.slice(end))
  return parts.join('')
}

export function relocateMarkdown(value: string, documentPath: string, move: FileRelocation, strict = false): string {
  return applyTextPatches(value, planReferenceRelocation(value, documentPath, move, strict))
}
