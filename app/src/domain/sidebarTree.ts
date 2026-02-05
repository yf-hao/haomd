import type { FileEntry } from '../modules/files/types'

export type FileTreeNode = {
  id: string
  name: string
  path: string
  kind: 'file' | 'dir'
  children?: FileTreeNode[]
}

export type ExpandedMap = Record<string, boolean>

const normalizeSeparators = (path: string): string => path.replace(/\\/g, '/')

const trimTrailingSlash = (path: string): string => path.replace(/[\\/]+$/, '')

const normalizePath = (path: string): string => trimTrailingSlash(normalizeSeparators(path))

const isSubPath = (root: string, target: string): boolean => {
  const normRoot = normalizePath(root)
  const normTarget = normalizePath(target)
  if (normRoot === normTarget) return true
  return normTarget.startsWith(normRoot.endsWith('/') ? normRoot : `${normRoot}/`)
}

const parentPathOf = (path: string): string | null => {
  const norm = normalizePath(path)
  const idx = norm.lastIndexOf('/')
  if (idx <= 0) return null
  return norm.slice(0, idx)
}

/**
 * 将扁平的文件/目录列表构造成层级树结构。
 * 约定：entries 中已经包含所有需要的目录节点（后端 collect_entries 会插入）。
 */
export function buildFileTree(root: string, entries: FileEntry[]): FileTreeNode[] {
  const normRoot = normalizePath(root)

  // 仅保留 root 子树内的条目
  const filtered = entries.filter((e) => isSubPath(normRoot, e.path) && normalizePath(e.path) !== normRoot)

  const nodeMap = new Map<string, FileTreeNode>()
  const roots: FileTreeNode[] = []

  // 先为每个 entry 创建节点
  for (const entry of filtered) {
    const path = normalizePath(entry.path)
    if (nodeMap.has(path)) continue
    const node: FileTreeNode = {
      id: path,
      path,
      name: entry.name,
      kind: entry.kind,
      children: entry.kind === 'dir' ? [] : undefined,
    }
    nodeMap.set(path, node)
  }

  // 第二遍：建立父子关系
  for (const node of nodeMap.values()) {
    const parentPath = parentPathOf(node.path)
    if (!parentPath || parentPath === normRoot) {
      roots.push(node)
      continue
    }
    const parent = nodeMap.get(parentPath)
    if (parent && parent.kind === 'dir') {
      if (!parent.children) parent.children = []
      parent.children.push(node)
    } else {
      // 找不到父节点（理论上不应发生），退化为根节点
      roots.push(node)
    }
  }

  // 保证同级节点的排序：目录在前，按名称字典序
  const sortChildren = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === 'dir' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) {
      if (n.children && n.children.length > 0) sortChildren(n.children)
    }
  }

  sortChildren(roots)
  return roots
}

export function toggleExpanded(prev: ExpandedMap, path: string): ExpandedMap {
  const norm = normalizePath(path)
  const next: ExpandedMap = { ...prev }
  next[norm] = !next[norm]
  return next
}

export function expandedMapFromPaths(paths: string[]): ExpandedMap {
  const map: ExpandedMap = {}
  for (const p of paths) {
    const norm = normalizePath(p)
    map[norm] = true
  }
  return map
}

export function expandedPathsFromMap(map: ExpandedMap): string[] {
  return Object.keys(map)
    .filter((p) => map[p])
    .sort()
}

/**
 * 计算为了让 filePath 在树中可见，需要展开的所有父目录路径（不包含 root 自身）。
 */
export function computeParentsToExpand(root: string, filePath: string): string[] {
  const normRoot = normalizePath(root)
  const normFile = normalizePath(filePath)
  if (!isSubPath(normRoot, normFile)) return []

  const parts = normalizeSeparators(normFile).split('/')
  const rootParts = normalizeSeparators(normRoot).split('/')
  const parents: string[] = []

  // 从 root 之后的每一级目录都应加入展开列表
  for (let i = rootParts.length + 1; i <= parts.length - 1; i++) {
    const dirPath = parts.slice(0, i).join('/')
    parents.push(dirPath)
  }

  return parents
}
