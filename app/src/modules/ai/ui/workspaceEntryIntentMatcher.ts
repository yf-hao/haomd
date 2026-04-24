import type { WorkspaceEntryKind } from '../../workspace/workspaceEntryResolver'

function stripWrappingQuotes(input: string): string {
  const trimmed = input.trim()
  return trimmed.replace(/^["'“”‘’](.+)["'“”‘’]$/u, '$1').trim()
}

export function matchDeleteWorkspaceEntry(input: string): { targetPath: string; targetKind?: WorkspaceEntryKind } | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  let match = trimmed.match(/^删除\s*(.+?)\s*下的\s*(.+?)\s*(目录|文件夹)$/i)
  if (match) {
    return {
      targetPath: `${stripWrappingQuotes(match[1]!)}/${stripWrappingQuotes(match[2]!)}`,
      targetKind: 'dir',
    }
  }

  match = trimmed.match(/^删除\s*(.+?)\s*下的\s*(.+?)\s*文件$/i)
  if (match) {
    return {
      targetPath: `${stripWrappingQuotes(match[1]!)}/${stripWrappingQuotes(match[2]!)}`,
      targetKind: 'file',
    }
  }

  match = trimmed.match(/^删除\s*(.+?)\s*下的\s*(.+)$/i)
  if (match) {
    const parent = stripWrappingQuotes(match[1]!)
    const leaf = stripWrappingQuotes(match[2]!)
    return {
      targetPath: `${parent}/${leaf}`,
      targetKind: /\.[^./\\]+$/.test(leaf) ? 'file' : undefined,
    }
  }

  return null
}

export function matchRenameWorkspaceEntry(input: string): {
  targetPath: string
  newName: string
  targetKind?: WorkspaceEntryKind
} | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  let match = trimmed.match(/^(?:把|将)\s*(.+?)\s*下的\s*(.+?)\s*(目录|文件夹)\s*(?:重命名为|改名为)\s*(.+)$/i)
  if (match) {
    return {
      targetPath: `${stripWrappingQuotes(match[1]!)}/${stripWrappingQuotes(match[2]!)}`,
      newName: stripWrappingQuotes(match[4]!),
      targetKind: 'dir',
    }
  }

  match = trimmed.match(/^(?:把|将)\s*(.+?)\s*下的\s*(.+?)\s*(?:文件)?\s*(?:重命名为|改名为)\s*(.+)$/i)
  if (match) {
    const targetName = stripWrappingQuotes(match[2]!)
    return {
      targetPath: `${stripWrappingQuotes(match[1]!)}/${targetName}`,
      newName: stripWrappingQuotes(match[3]!),
      targetKind: /\.[^./\\]+$/.test(targetName) ? 'file' : undefined,
    }
  }

  return null
}

export function matchCreateDirectoryInWorkspace(input: string): {
  parentPath: string
  directoryName: string
} | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  let match = trimmed.match(/^在\s*(.+?)\s*下创建(?:一个)?名为\s*(.+?)\s*的(?:目录|文件夹)$/i)
  if (match) {
    return {
      parentPath: stripWrappingQuotes(match[1]!),
      directoryName: stripWrappingQuotes(match[2]!),
    }
  }

  match = trimmed.match(/^在\s*(.+?)\s*下创建\s*(.+?)\s*(?:目录|文件夹)$/i)
  if (match) {
    return {
      parentPath: stripWrappingQuotes(match[1]!),
      directoryName: stripWrappingQuotes(match[2]!),
    }
  }

  return null
}
