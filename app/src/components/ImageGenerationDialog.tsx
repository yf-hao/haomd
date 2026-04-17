import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import './ImageGenerationDialog.css'
import { FieldGroup } from './FieldGroup'
import { Button } from './Button'
import { useI18n } from '../modules/i18n/I18nContext'
import type { AgentProvider } from '../modules/ai/domain/types'
import {
  loadImageGenerationAgents,
  runImageGenerationWithAgent,
} from '../modules/ai/agents/imageGeneration/imageGenerationAgentService'
import {
  appendImageGenerationHistory,
  listImageGenerationHistory,
  type ImageGenerationHistoryItem,
} from '../modules/ai/agents/imageGeneration/imageGenerationHistoryRepo'
import {
  buildImageMarkdown,
  insertGeneratedImageIntoEditor,
  saveRemoteImageWithDialog,
} from '../modules/ai/agents/imageGeneration/imageGenerationResultService'
import { saveImageGenerationToNotes } from '../modules/ai/agents/imageGeneration/imageGenerationNotesBridge'
import type {
  ImageGenerationResult,
  ImageGenerationTaskStatus,
} from '../modules/ai/agents/imageGeneration/types'

export type ImageGenerationDialogProps = {
  open: boolean
  onClose: () => void
  initialAgentId?: string | null
}

export const ImageGenerationDialog: FC<ImageGenerationDialogProps> = ({
  open,
  onClose,
  initialAgentId = null,
}) => {
  const { t } = useI18n()
  const [agents, setAgents] = useState<AgentProvider[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState<ImageGenerationTaskStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [result, setResult] = useState<ImageGenerationResult | null>(null)
  const [history, setHistory] = useState<ImageGenerationHistoryItem[]>([])

  useEffect(() => {
    if (!open) return

    let disposed = false

    const doLoad = async () => {
      try {
        const nextAgents = await loadImageGenerationAgents()
        if (disposed) return
        setAgents(nextAgents)
        const nextSelected =
          (initialAgentId && nextAgents.some((item) => item.id === initialAgentId) ? initialAgentId : null)
          ?? nextAgents[0]?.id
          ?? ''
        setSelectedAgentId(nextSelected)
        setPrompt('')
        setError(null)
        setActionMessage(null)
        setResult(null)
        setHistory(listImageGenerationHistory())
        setStatus('idle')
      } catch (err) {
        if (disposed) return
        setAgents([])
        setSelectedAgentId('')
        setStatus('failed')
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    void doLoad()

    return () => {
      disposed = true
    }
  }, [initialAgentId, open])

  const selectedAgent = useMemo(
    () => agents.find((item) => item.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  )

  const handleGenerate = async () => {
    if (!selectedAgent) {
      setError(t('imageGeneration.noAgent'))
      return
    }
    if (!prompt.trim()) {
      setError(t('imageGeneration.fillPrompt'))
      return
    }

    setStatus('running')
    setError(null)
    setResult(null)

    try {
      const nextResult = await runImageGenerationWithAgent(selectedAgent, { prompt: prompt.trim() })
      setResult(nextResult)
      appendImageGenerationHistory({
        agentId: selectedAgent.id,
        agentName: selectedAgent.name,
        prompt: prompt.trim(),
        result: nextResult,
      })
      setHistory(listImageGenerationHistory())
      setActionMessage(null)
      setStatus('succeeded')
    } catch (err) {
      setStatus('failed')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCopyUrl = async () => {
    if (!result?.imageUrl || !navigator?.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(result.imageUrl)
      setActionMessage(t('imageGeneration.copiedUrl'))
    } catch (err) {
      console.warn('[ImageGenerationDialog] copy failed', err)
    }
  }

  const handleCopyMarkdown = async () => {
    if (!result?.imageUrl || !navigator?.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(buildImageMarkdown({ imageUrl: result.imageUrl, prompt }))
      setActionMessage(t('imageGeneration.copiedMarkdown'))
    } catch (err) {
      console.warn('[ImageGenerationDialog] copy markdown failed', err)
    }
  }

  const handleSaveLocal = async () => {
    if (!result?.imageUrl) return
    try {
      await saveRemoteImageWithDialog({ imageUrl: result.imageUrl, prompt })
      setActionMessage(t('imageGeneration.savedLocal'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleInsertToEditor = async () => {
    if (!result?.imageUrl) return
    try {
      await insertGeneratedImageIntoEditor({ imageUrl: result.imageUrl, prompt })
      setActionMessage(t('imageGeneration.insertedEditor'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleSaveToNotes = async () => {
    if (!selectedAgent || !result) return
    try {
      const notePath = await saveImageGenerationToNotes({
        agent: selectedAgent,
        prompt,
        result,
      })
      setActionMessage(t('imageGeneration.savedToNotes', { path: notePath }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-image-generation" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title">{t('imageGeneration.title')}</div>
        <div className="modal-content image-generation-layout">
          <div className="image-generation-form">
            <FieldGroup label={t('imageGeneration.agent')}>
              <select
                className="field-select"
                value={selectedAgentId}
                onChange={(event) => setSelectedAgentId(event.target.value)}
              >
                {agents.length === 0 && <option value="">{t('imageGeneration.noAgent')}</option>}
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </FieldGroup>

            <FieldGroup label={t('imageGeneration.prompt')}>
              <textarea
                className="field-textarea image-generation-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={t('imageGeneration.promptPlaceholder')}
              />
            </FieldGroup>

            {selectedAgent && (
              <div className="image-generation-meta">
                <div>{t('imageGeneration.baseUrlLabel', { url: selectedAgent.baseUrl })}</div>
                <div>{t('imageGeneration.modelLabel', { model: selectedAgent.modelId ?? '-' })}</div>
              </div>
            )}

            {status === 'running' && (
              <div className="image-generation-status">{t('imageGeneration.running')}</div>
            )}
            {error && (
              <div className="image-generation-status image-generation-status-error">{error}</div>
            )}
            {actionMessage && !error && (
              <div className="image-generation-status">{actionMessage}</div>
            )}
          </div>

          <div className="image-generation-preview">
            {result ? (
              <>
                <img
                  className="image-generation-preview-image"
                  src={result.imageUrl}
                  alt={t('imageGeneration.resultAlt')}
                />
                <div className="image-generation-meta">
                  <div>{t('imageGeneration.taskIdLabel', { taskId: result.taskId })}</div>
                  <div className="image-generation-url">{result.imageUrl}</div>
                </div>
                <div className="image-generation-preview-actions">
                  <Button variant="tertiary" onClick={handleCopyUrl}>
                    {t('imageGeneration.copyUrl')}
                  </Button>
                  <Button variant="tertiary" onClick={handleCopyMarkdown}>
                    {t('imageGeneration.copyMarkdown')}
                  </Button>
                  <Button variant="tertiary" onClick={handleSaveLocal}>
                    {t('imageGeneration.saveLocal')}
                  </Button>
                  <Button variant="tertiary" onClick={handleInsertToEditor}>
                    {t('imageGeneration.insertEditor')}
                  </Button>
                  <Button variant="tertiary" onClick={handleSaveToNotes}>
                    {t('imageGeneration.saveToNotes')}
                  </Button>
                  <a
                    className="modal-btn tertiary"
                    href={result.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="btn-label">{t('imageGeneration.openImage')}</span>
                  </a>
                </div>
              </>
            ) : (
              <div className="image-generation-empty">{t('imageGeneration.emptyResult')}</div>
            )}
            <div className="image-generation-history">
              <div className="image-generation-history-title">{t('imageGeneration.recentHistory')}</div>
              {history.length === 0 ? (
                <div className="image-generation-empty">{t('imageGeneration.emptyHistory')}</div>
              ) : (
                history.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="image-generation-history-item"
                    onClick={() => {
                      setPrompt(item.prompt)
                      setActionMessage(null)
                      setError(null)
                      setResult({
                        taskId: item.taskId,
                        imageUrl: item.imageUrl,
                      })
                      setStatus('succeeded')
                    }}
                  >
                    <span className="image-generation-history-prompt">{item.prompt}</span>
                    <span className="image-generation-history-meta">
                      {item.agentName} · {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <Button variant="tertiary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleGenerate} loading={status === 'running'}>
            {t('imageGeneration.generate')}
          </Button>
        </div>
      </div>
    </div>
  )
}
