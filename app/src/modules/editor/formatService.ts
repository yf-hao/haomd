import type { TextColorTarget } from './textColorTarget'

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

/**
 * Heading 相关编辑行为的桥接服务。
 * 具体实现由 WorkspaceShell 注册，命令系统通过这里调用。
 */

type ApplyHeadingImpl = ((level: HeadingLevel) => void | Promise<void>) | null

type ResetHeadingImpl = (() => void | Promise<void>) | null

type EmphasizeSelectionImpl = (() => void | Promise<void>) | null

type ToggleStrikethroughImpl = (() => void | Promise<void>) | null

type InsertCodeBlockImpl = (() => void | Promise<void>) | null

type InsertMathSymbolImpl = ((latex: string) => void | Promise<void>) | null

type ApplyTextColorImpl = ((color: string) => void | Promise<void>) | null

type ClearTextColorImpl = (() => void | Promise<void>) | null

type GetCurrentTextColorImpl = (() => string | null | Promise<string | null>) | null

type GetCurrentTextColorTargetImpl = (() => TextColorTarget | null | Promise<TextColorTarget | null>) | null

type ApplyTextColorToTargetImpl = ((color: string | null, target: TextColorTarget) => boolean | Promise<boolean>) | null

let applyHeadingImpl: ApplyHeadingImpl = null
let resetHeadingImpl: ResetHeadingImpl = null
let emphasizeSelectionImpl: EmphasizeSelectionImpl = null
let toggleStrikethroughImpl: ToggleStrikethroughImpl = null
let insertCodeBlockImpl: InsertCodeBlockImpl = null
let insertMathSymbolImpl: InsertMathSymbolImpl = null
let applyTextColorImpl: ApplyTextColorImpl = null
let clearTextColorImpl: ClearTextColorImpl = null
let getCurrentTextColorImpl: GetCurrentTextColorImpl = null
let getCurrentTextColorTargetImpl: GetCurrentTextColorTargetImpl = null
let applyTextColorToTargetImpl: ApplyTextColorToTargetImpl = null

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

// ===== 删除线 =====

export function registerToggleStrikethrough(fn: () => void | Promise<void>): void {
  toggleStrikethroughImpl = fn
}

export async function toggleStrikethrough(): Promise<void> {
  if (!toggleStrikethroughImpl) {
    console.warn('[formatService] toggleStrikethrough called but no implementation registered')
    return
  }
  await Promise.resolve(toggleStrikethroughImpl())
}

// ===== Code Block 插入 =====

export function registerInsertCodeBlock(fn: () => void | Promise<void>): void {
  insertCodeBlockImpl = fn
}

export async function insertCodeBlock(): Promise<void> {
  if (!insertCodeBlockImpl) {
    console.warn('[formatService] insertCodeBlock called but no implementation registered')
    return
  }
  await Promise.resolve(insertCodeBlockImpl())
}

// ===== 数学符号插入 =====

export function registerInsertMathSymbol(fn: (latex: string) => void | Promise<void>): void {
  insertMathSymbolImpl = fn
}

export async function insertMathSymbol(latex: string): Promise<void> {
  if (!insertMathSymbolImpl) {
    console.warn('[formatService] insertMathSymbol called but no implementation registered')
    return
  }
  await Promise.resolve(insertMathSymbolImpl(latex))
}

// ===== 文字颜色 =====

export function registerApplyTextColor(fn: (color: string) => void | Promise<void>): void {
  applyTextColorImpl = fn
}

export async function applyTextColor(color: string): Promise<void> {
  if (!applyTextColorImpl) {
    console.warn('[formatService] applyTextColor called but no implementation registered')
    return
  }
  await Promise.resolve(applyTextColorImpl(color))
}

export function registerClearTextColor(fn: () => void | Promise<void>): void {
  clearTextColorImpl = fn
}

export async function clearTextColor(): Promise<void> {
  if (!clearTextColorImpl) {
    console.warn('[formatService] clearTextColor called but no implementation registered')
    return
  }
  await Promise.resolve(clearTextColorImpl())
}

export function registerGetCurrentTextColor(fn: () => string | null | Promise<string | null>): void {
  getCurrentTextColorImpl = fn
}

export async function getCurrentTextColor(): Promise<string | null> {
  if (!getCurrentTextColorImpl) {
    console.warn('[formatService] getCurrentTextColor called but no implementation registered')
    return null
  }
  return await Promise.resolve(getCurrentTextColorImpl())
}

export function registerGetCurrentTextColorTarget(fn: () => TextColorTarget | null | Promise<TextColorTarget | null>): void {
  getCurrentTextColorTargetImpl = fn
}

export async function getCurrentTextColorTarget(): Promise<TextColorTarget | null> {
  if (!getCurrentTextColorTargetImpl) {
    console.warn('[formatService] getCurrentTextColorTarget called but no implementation registered')
    return null
  }
  return await Promise.resolve(getCurrentTextColorTargetImpl())
}

export function registerApplyTextColorToTarget(
  fn: (color: string | null, target: TextColorTarget) => boolean | Promise<boolean>,
): void {
  applyTextColorToTargetImpl = fn
}

export async function applyTextColorToTarget(color: string | null, target: TextColorTarget): Promise<boolean> {
  if (!applyTextColorToTargetImpl) {
    console.warn('[formatService] applyTextColorToTarget called but no implementation registered')
    return false
  }
  return await Promise.resolve(applyTextColorToTargetImpl(color, target))
}
