export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

/**
 * Heading 相关编辑行为的桥接服务。
 * 具体实现由 WorkspaceShell 注册，命令系统通过这里调用。
 */

type ApplyHeadingImpl = ((level: HeadingLevel) => void | Promise<void>) | null

type ResetHeadingImpl = (() => void | Promise<void>) | null

type EmphasizeSelectionImpl = (() => void | Promise<void>) | null

let applyHeadingImpl: ApplyHeadingImpl = null
let resetHeadingImpl: ResetHeadingImpl = null
let emphasizeSelectionImpl: EmphasizeSelectionImpl = null

export function registerApplyHeadingLevel(fn: (level: HeadingLevel) => void | Promise<void>): void {
  applyHeadingImpl = fn
}

export async function applyHeadingLevel(level: HeadingLevel): Promise<void> {
  if (!applyHeadingImpl) {
    // 在纯 Web 环境或尚未注册实现时，保持静默失败（只输出警告），避免抛错
    console.warn('[formatService] applyHeadingLevel called but no implementation registered')
    return
  }
  await Promise.resolve(applyHeadingImpl(level))
}

// ===== 段落相关（从标题恢复为普通文本） =====

export function registerResetHeadingToParagraph(fn: () => void | Promise<void>): void {
  resetHeadingImpl = fn
}

export async function resetHeadingToParagraph(): Promise<void> {
  if (!resetHeadingImpl) {
    console.warn('[formatService] resetHeadingToParagraph called but no implementation registered')
    return
  }
  await Promise.resolve(resetHeadingImpl())
}

// ===== 强调选区（Emphasis） =====

export function registerEmphasizeSelection(fn: () => void | Promise<void>): void {
  emphasizeSelectionImpl = fn
}

export async function emphasizeSelection(): Promise<void> {
  if (!emphasizeSelectionImpl) {
    console.warn('[formatService] emphasizeSelection called but no implementation registered')
    return
  }
  await Promise.resolve(emphasizeSelectionImpl())
}
