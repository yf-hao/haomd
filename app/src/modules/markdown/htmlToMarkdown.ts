const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'UL',
])

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_[\]{}])/g, '\\$1')
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, ' ')
}

function cleanUrl(value: string): string {
  return value.trim().replace(/[<>]/g, '')
}

function convertTable(table: HTMLTableElement): string {
  const rows = Array.from(table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr'))
  if (rows.length === 0) return ''

  const matrix = rows.map((row) =>
    Array.from(row.children)
      .filter((cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement)
      .map((cell) => convertChildren(cell).trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ')),
  )
  const columnCount = Math.max(...matrix.map((row) => row.length), 0)
  if (columnCount === 0) return ''

  const normalizedRows = matrix.map((row) => (
    Array.from({ length: columnCount }, (_, index) => row[index] ?? '')
  ))
  const header = normalizedRows[0]
  const separator = header.map(() => '---')
  return [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...normalizedRows.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function convertList(list: HTMLElement): string {
  const ordered = list.tagName === 'OL'
  const items = Array.from(list.children).filter(
    (child): child is HTMLLIElement => child.tagName === 'LI',
  )

  return items.map((item, index) => {
    const marker = ordered ? `${index + 1}. ` : '- '
    const value = convertChildren(item).trim()
    const lines = value.split('\n')
    return `${marker}${lines.join('\n  ')}`
  }).join('\n')
}

function convertCodeBlock(pre: HTMLPreElement): string {
  const code = pre.querySelector('code')
  const value = (code?.textContent ?? pre.textContent ?? '').replace(/\r\n?/g, '\n').trim()
  const language = code?.className.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? ''
  return `\`\`\`${language}\n${value}\n\`\`\``
}

function convertImage(image: HTMLImageElement): string {
  const source = image.getAttribute('src')?.trim()
    || image.getAttribute('data-src')?.trim()
    || image.getAttribute('data-original')?.trim()
    || ''
  if (!source) return ''

  const alt = escapeMarkdownText(image.getAttribute('alt')?.trim() || '图片')
  const title = image.getAttribute('title')?.trim()
  return `![${alt}](${cleanUrl(source)}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`
}

function convertNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.textContent ?? ''
    return value.trim() ? normalizeInlineText(value) : ''
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const element = node as HTMLElement
  const tag = element.tagName
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return ''
  if (tag === 'IMG') return convertImage(element as HTMLImageElement)
  if (tag === 'BR') return '\n'
  if (tag === 'HR') return '\n\n---\n\n'
  if (/^H[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1))
    return `\n\n${'#'.repeat(level)} ${convertChildren(element).trim()}\n\n`
  }
  if (tag === 'PRE') return `\n\n${convertCodeBlock(element as HTMLPreElement)}\n\n`
  if (tag === 'TABLE') return `\n\n${convertTable(element as HTMLTableElement)}\n\n`
  if (tag === 'UL' || tag === 'OL') return `\n\n${convertList(element)}\n\n`
  if (tag === 'BLOCKQUOTE') {
    const value = convertChildren(element).trim()
    return `\n\n${value.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`
  }
  if (tag === 'A') {
    const href = cleanUrl(element.getAttribute('href') ?? '')
    const value = convertChildren(element).trim() || href
    return href ? `[${value}](${href})` : value
  }
  if (tag === 'STRONG' || tag === 'B') {
    return `**${convertChildren(element).trim()}**`
  }
  if (tag === 'EM' || tag === 'I') {
    return `*${convertChildren(element).trim()}*`
  }
  if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') {
    return `~~${convertChildren(element).trim()}~~`
  }
  if (tag === 'CODE') {
    return `\`${(element.textContent ?? '').replace(/`/g, '\\`')}\``
  }

  const value = convertChildren(element)
  return BLOCK_TAGS.has(tag) ? `\n\n${value.trim()}\n\n` : value
}

function convertChildren(parent: Node): string {
  return Array.from(parent.childNodes).map(convertNode).join('')
}

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return ''
  const document = new DOMParser().parseFromString(html, 'text/html')
  const markdown = convertChildren(document.body)
  return markdown
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
