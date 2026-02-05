export type OutlineItem = {
  id: string
  level: 1 | 2 | 3 | 4 | 5 | 6
  text: string
  line: number
}

export function buildOutlineFromMarkdown(source: string): OutlineItem[] {
  const lines = source.split(/\r?\n/)
  const items: OutlineItem[] = []
  let counter = 0

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    const match = /^(#{1,6})\s+(.+)$/.exec(raw)
    if (!match) continue

    const level = match[1].length as 1 | 2 | 3 | 4 | 5 | 6
    const text = match[2].trim()

    items.push({
      id: `h-${level}-${counter++}`,
      level,
      text,
      line: i + 1,
    })
  }

  return items
}
