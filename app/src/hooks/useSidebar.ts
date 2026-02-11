import { useCallback, useEffect, useState } from 'react'
import { buildFileTree, computeParentsToExpand, expandedMapFromPaths, expandedPathsFromMap, toggleExpanded } from '../domain/sidebarTree'
import type { ExpandedMap, FileTreeNode } from '../domain/sidebarTree'
import { listFolder, logRecentFile } from '../modules/files/service'
import { loadSidebarState, saveSidebarState } from '../modules/sidebar/sidebarStateRepo'

function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, '/')
}

function trimTrailingSlash(path: string): string {
  return path.replace(/[\\/]+$/, '')
}

function normalizePath(path: string): string {
  return trimTrailingSlash(normalizeSeparators(path))
}

function dirname(path: string): string | null {
  const norm = normalizePath(path)
  const idx = norm.lastIndexOf('/')
  if (idx <= 0) return null
  return norm.slice(0, idx)
}

type StandaloneFileItem = {
  path: string
  name: string
}

export function useSidebar() {
  const [root, setRoot] = useState<string | null>(null)
  const [treesByRoot, setTreesByRoot] = useState<Record<string, FileTreeNode[]>>({})
  const [expanded, setExpanded] = useState<ExpandedMap>({})
  const [standaloneFiles, setStandaloneFiles] = useState<StandaloneFileItem[]>([])
  const [folderRoots, setFolderRoots] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)

  // 启动时加载持久化的侧边栏状态
  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      const state = await loadSidebarState()
      if (cancelled) return

      // folderRoots：优先使用持久化列表，否则从 root 推导
      const roots = state.folderRoots && state.folderRoots.length > 0
        ? state.folderRoots
        : state.root
          ? [state.root]
          : []

      setFolderRoots(roots)
      const primaryRoot = state.root ?? roots[0] ?? null
      setRoot(primaryRoot)
      setExpanded(expandedMapFromPaths(state.expandedPaths))

      if (roots.length > 0) {
        const trees: Record<string, FileTreeNode[]> = {}
        for (const rawRoot of roots) {
          const normalizedRoot = normalizePath(rawRoot)
          const result = await listFolder(normalizedRoot)
          if (cancelled) return
          if (!result.ok) {
            console.warn('[useSidebar] listFolder failed when bootstrap:', result.error)
            continue
          }
          trees[normalizedRoot] = buildFileTree(normalizedRoot, result.data)
        }
        setTreesByRoot(trees)
      }

      if (state.standaloneFiles && state.standaloneFiles.length > 0) {
        setStandaloneFiles(
          state.standaloneFiles.map((path) => ({
            path,
            name: path.split(/[/\\]/).pop() ?? path,
          })),
        )
      }

      setHydrated(true)
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [])

  // root / expanded / standaloneFiles / folderRoots 变化时保存到后端
  useEffect(() => {
    if (!hydrated) return
    const state = {
      root: root ?? (folderRoots[0] ?? null),
      expandedPaths: expandedPathsFromMap(expanded),
      standaloneFiles: standaloneFiles.map((f) => f.path),
      folderRoots,
    }
    void saveSidebarState(state)
  }, [root, expanded, standaloneFiles, folderRoots, hydrated])

  const toggleNode = useCallback((path: string) => {
    setExpanded((prev) => toggleExpanded(prev, path))
  }, [])

  const addStandaloneFile = useCallback((filePath: string) => {
    const norm = normalizePath(filePath)
    const name = norm.split('/').pop() ?? norm
    setStandaloneFiles((prev) => {
      if (prev.some((f) => f.path === norm)) return prev
      return [...prev, { path: norm, name }]
    })
  }, [])

  const removeStandaloneFile = useCallback((filePath: string) => {
    const norm = normalizePath(filePath)
    setStandaloneFiles((prev) => prev.filter((f) => f.path !== norm))
  }, [])

  const openFolderAsRoot = useCallback(async (path: string) => {
    const normalized = normalizePath(path)
    const result = await listFolder(normalized)
    if (!result.ok) {
      console.warn('[useSidebar] openFolderAsRoot listFolder error:', result.error)
      return
    }

    // 成功读取目录后，将该目录写入最近列表（作为最近文件夹）
    const recentResult = await logRecentFile(normalized, true)
    if (!recentResult.ok) {
      console.warn('[useSidebar] logRecentFile for folder failed:', recentResult.error)
    }

    setRoot((prev) => prev ?? normalized)
    setTreesByRoot((prev) => ({
      ...prev,
      [normalized]: buildFileTree(normalized, result.data),
    }))
    setExpanded((prev) => ({
      ...prev,
      [normalized]: true,
    }))
    setFolderRoots((prev) => {
      if (prev.includes(normalized)) return prev
      return [...prev, normalized]
    })
  }, [])

  const removeFolderRoot = useCallback((path: string) => {
    const norm = normalizePath(path)
    setFolderRoots((prev) => prev.filter((p) => normalizePath(p) !== norm))
    setTreesByRoot((prev) => {
      const next = { ...prev }
      delete next[norm]
      return next
    })
    setRoot((prevRoot) => {
      if (!prevRoot || normalizePath(prevRoot) !== norm) return prevRoot
      const remaining = folderRoots.filter((p) => normalizePath(p) !== norm)
      return remaining.length > 0 ? normalizePath(remaining[0]) : null
    })
  }, [folderRoots])

  const ensureFileVisible = useCallback(
    async (filePath: string) => {
      if (!filePath) return

      const normalizedFile = normalizePath(filePath)

      // 没有任何根：使用文件父目录作为根目录
      if (folderRoots.length === 0) {
        const dir = dirname(normalizedFile)
        if (!dir) return

        await openFolderAsRoot(dir)
        // 展开从 dir 到文件的所有父目录
        setExpanded((prev) => {
          const next: ExpandedMap = { ...prev }
          const parents = computeParentsToExpand(dir, normalizedFile)
          for (const p of parents) {
            next[normalizePath(p)] = true
          }
          return next
        })
        return
      }

      // 已有根：如果文件在某个根目录子树内，则展开其父目录链
      const rootForFile = folderRoots.find((r) => {
        const parents = computeParentsToExpand(r, normalizedFile)
        return parents.length > 0
      })

      if (!rootForFile) return

      setExpanded((prev) => {
        const next: ExpandedMap = { ...prev }
        const parents = computeParentsToExpand(rootForFile, normalizedFile)
        for (const p of parents) {
          next[normalizePath(p)] = true
        }
        return next
      })
    },
    [folderRoots, openFolderAsRoot],
  )

  return {
    root,
    treesByRoot,
    expanded,
    standaloneFiles,
    folderRoots,
    toggleNode,
    openFolderAsRoot,
    ensureFileVisible,
    addStandaloneFile,
    removeStandaloneFile,
    removeFolderRoot,
  }
}
