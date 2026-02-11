// rehype 插件：给 KaTeX 根元素补充 data-line-start / data-line-end 属性
// 设计目标：
// - 只处理 className 包含 katex-display / katex 的元素
// - 仅当节点存在 position.start.line 时才写入行号
// - 不覆盖已有的 data-line-* 属性，避免与其它插件冲突

export function rehypeMathLineAnchors() {
  return function attach(tree: any) {
    // 递归遍历树，允许子节点继承父节点的位置信息
    const visit = (node: any, inheritedPos?: any): void => {
      if (!node || typeof node !== 'object') return

      // 优先使用节点自身的 position，其次继承父节点的 position
      const pos = (node as any).position || inheritedPos

      // 只关心 element 节点
      if (node.type === 'element') {
        const props = node.properties || {}
        const className = props.className

        if (className) {
          const classes = Array.isArray(className)
            ? className
            : String(className).split(/\s+/)

          const isKatexDisplay = classes.includes('katex-display')
          const isKatexInline = classes.includes('katex') && !classes.includes('katex-display')

          if (isKatexDisplay || isKatexInline) {
            const startLine = pos?.start?.line
            const endLine = pos?.end?.line ?? startLine

            if (typeof console !== 'undefined') {
              console.log('[rehypeMathLineAnchors] class=%o pos=%o start=%s end=%s props(before)=%o', classes, pos, startLine, endLine, props)
            }

            if (typeof startLine === 'number') {
              if (!node.properties) node.properties = props

              if (node.properties['data-line-start'] == null) {
                node.properties['data-line-start'] = String(startLine)
              }
              if (endLine != null && node.properties['data-line-end'] == null) {
                node.properties['data-line-end'] = String(endLine)
              }

              if (typeof console !== 'undefined') {
                console.log('[rehypeMathLineAnchors] props(after)=%o', node.properties)
              }
            }
          }
        }
      }

      const children = (node as any).children
      if (Array.isArray(children)) {
        for (const child of children) visit(child, pos)
      }
    }

    visit(tree)
  }
}
