export type AlignedTabRow<T> = {
  left: T[]
  right: T[]
}

type SplitOptions<T> = {
  getText: (node: T) => string | null
  createText: (value: string, source: T) => T
}

type MutableRow<T> = AlignedTabRow<T> & {
  hasMarker: boolean
}

const ALIGN_MARKER = '\\t'

export function splitAlignedTabInlineNodes<T>(
  nodes: T[],
  options: SplitOptions<T>,
): AlignedTabRow<T>[] | null {
  const rows: MutableRow<T>[] = [createRow()]
  let foundMarker = false

  const pushNode = (node: T) => {
    const row = rows[rows.length - 1]
    if (row.hasMarker) {
      row.right.push(node)
    } else {
      row.left.push(node)
    }
  }

  const nextLine = () => {
    rows.push(createRow())
  }

  for (const node of nodes) {
    const text = options.getText(node)
    if (text == null) {
      pushNode(node)
      continue
    }

    let cursor = 0
    while (cursor < text.length) {
      const markerIndex = text.indexOf(ALIGN_MARKER, cursor)
      const newlineIndex = text.indexOf('\n', cursor)
      const nextIndex = minPositive(markerIndex, newlineIndex)

      if (nextIndex === -1) {
        const segment = text.slice(cursor)
        if (segment) pushNode(options.createText(segment, node))
        break
      }

      const segment = text.slice(cursor, nextIndex)
      if (segment) pushNode(options.createText(segment, node))

      if (nextIndex === markerIndex) {
        rows[rows.length - 1].hasMarker = true
        foundMarker = true
        cursor = nextIndex + ALIGN_MARKER.length
      } else {
        nextLine()
        cursor = nextIndex + 1
      }
    }
  }

  if (!foundMarker) return null

  const meaningfulRows = rows.filter((row) => rowHasContent(row, options))
  if (!meaningfulRows.length) return null
  if (meaningfulRows.some((row) => !row.hasMarker)) return null

  return meaningfulRows.map((row) => ({
    left: trimTextEdges(row.left, options),
    right: trimTextEdges(row.right, options),
  }))
}

function createRow<T>(): MutableRow<T> {
  return {
    left: [],
    right: [],
    hasMarker: false,
  }
}

function minPositive(a: number, b: number): number {
  if (a === -1) return b
  if (b === -1) return a
  return Math.min(a, b)
}

function rowHasContent<T>(row: AlignedTabRow<T>, options: SplitOptions<T>): boolean {
  return [...row.left, ...row.right].some((node) => {
    const text = options.getText(node)
    return text == null || text.trim().length > 0
  })
}

function trimTextEdges<T>(nodes: T[], options: SplitOptions<T>): T[] {
  const next = [...nodes]

  for (let i = 0; i < next.length; i += 1) {
    const text = options.getText(next[i])
    if (text == null) {
      break
    }

    const trimmed = text.trimStart()
    if (trimmed.length === 0) {
      next.splice(i, 1)
      i -= 1
      continue
    }

    if (trimmed !== text) next[i] = options.createText(trimmed, next[i])
    break
  }

  for (let i = next.length - 1; i >= 0; i -= 1) {
    const text = options.getText(next[i])
    if (text == null) {
      break
    }

    const trimmed = text.trimEnd()
    if (trimmed.length === 0) {
      next.splice(i, 1)
      continue
    }

    if (trimmed !== text) next[i] = options.createText(trimmed, next[i])
    break
  }

  return next
}
