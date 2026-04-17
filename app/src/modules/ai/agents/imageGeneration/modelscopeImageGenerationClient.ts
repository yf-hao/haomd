import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../../platform/backendTypes'
import { isTauriEnv } from '../../../platform/runtime'
import type {
  ImageGenerationAgentProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
} from './types'

type BackendImageGenerationResult = {
  taskId: string
  imageUrl: string
  raw?: unknown
}

export async function runModelscopeImageGeneration(
  provider: ImageGenerationAgentProvider,
  request: ImageGenerationRequest,
): Promise<ImageGenerationResult> {
  if (!isTauriEnv()) {
    throw new Error('当前仅桌面端支持图片生成 Agent')
  }

  const response = await invoke<BackendResult<BackendImageGenerationResult>>(
    'run_modelscope_image_generation',
    {
      req: {
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        modelId: provider.modelId,
        prompt: request.prompt,
        aspectRatio: request.aspectRatio,
      },
    },
  )

  if ('Err' in response) {
    throw new Error(response.Err.error.message)
  }

  return {
    taskId: response.Ok.data.taskId,
    imageUrl: response.Ok.data.imageUrl,
    raw: response.Ok.data.raw,
  }
}
