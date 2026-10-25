import { open } from '@tauri-apps/plugin-dialog'
import { importWorkflowFromDirectory } from '../storage/workflowsRepo'

export async function pickAndImportWorkflow(title: string) {
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  })
  if (!selected || Array.isArray(selected)) return null
  return importWorkflowFromDirectory(selected)
}
