import { useMemo, useState, useEffect } from 'react'
import { buildOutlineFromMarkdown, buildOutlineTree, type OutlineItem } from '../modules/outline/parser'

export function useOutline(markdown: string, debounceMs = 300): OutlineItem[] {
  // ✅ 添加防抖，避免每次打字都重新计算
  const [debouncedMarkdown, setDebouncedMarkdown] = useState(markdown)
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedMarkdown(markdown)
    }, debounceMs)
    
    return () => clearTimeout(timer)
  }, [markdown, debounceMs])
  
  return useMemo(() => {
    const items = buildOutlineFromMarkdown(debouncedMarkdown)
    return buildOutlineTree(items)
  }, [debouncedMarkdown])
}
