import { open } from '@tauri-apps/plugin-dialog'
import { importSkillFromDirectory } from '../storage/skillsRepo'

export async function pickAndImportSkill(title: string): Promise<boolean> {
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  })
  if (!selected || Array.isArray(selected)) return false
  await importSkillFromDirectory(selected)
  return true
}
