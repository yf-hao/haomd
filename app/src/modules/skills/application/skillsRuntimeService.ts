import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'

export type SkillRunResult = {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
}

export async function runSkillScript(
  skillId: string,
  scriptId: string,
  args: unknown,
): Promise<SkillRunResult> {
  const resp = await invoke<BackendResult<SkillRunResult>>('run_skill_script', {
    request: {
      skillId,
      scriptId,
      args,
    },
  })
  if ('Ok' in resp) {
    return resp.Ok.data
  }
  throw new Error(resp.Err.error.message)
}
