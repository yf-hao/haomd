const LOCAL_DELETE_CURRENT_DOCUMENT_PATTERNS = [
  /^删除$/,
  /^删除当前文档$/,
  /^删除当前文件$/,
  /^删掉当前文档$/,
  /^删掉当前文件$/,
  /^delete$/,
  /^delete current document$/,
  /^delete current file$/,
  /^remove current document$/,
  /^remove current file$/,
] as const

const LOCAL_DELETE_CURRENT_FOLDER_PATTERNS = [
  /^删除文件夹$/,
  /^删除当前文件夹$/,
  /^删掉文件夹$/,
  /^删掉当前文件夹$/,
  /^delete folder$/,
  /^delete current folder$/,
  /^remove folder$/,
  /^remove current folder$/,
] as const

export function shouldTriggerDeleteCurrentDocument(input: string): boolean {
  const normalized = input.trim().toLowerCase()
  if (!normalized) {
    return false
  }

  return LOCAL_DELETE_CURRENT_DOCUMENT_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function shouldTriggerDeleteCurrentFolder(input: string): boolean {
  const normalized = input.trim().toLowerCase()
  if (!normalized) {
    return false
  }

  return LOCAL_DELETE_CURRENT_FOLDER_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function buildDeleteConfirmationPrompt(targetLabel = '当前文档'): string {
  return `请确认是否删除${targetLabel}。\n\n确认删除请回复：确认删除\n若取消请回复：取消`
}
