import { useEffect, useState } from 'react'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'

export function ChatComposer({
  disabled,
  onSend,
  onVoiceError,
}: {
  disabled?: boolean
  onSend: (value: string) => Promise<void> | void
  onVoiceError?: (message: string) => void
}) {
  const [value, setValue] = useState('')
  const {
    supported,
    listening,
    error: voiceError,
    start,
    stop,
    clearError,
  } = useSpeechRecognition({
    onResult: (text) => {
      setValue((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${text}`.trimStart())
    },
  })

  const submit = async () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    await onSend(trimmed)
    setValue('')
  }

  useEffect(() => {
    if (!voiceError || !onVoiceError) return
    onVoiceError(voiceError)
    clearError()
  }, [clearError, onVoiceError, voiceError])

  return (
    <div className="web-composer">
      <div className="web-composer-main">
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="输入消息..."
          rows={3}
        />
        {listening ? <div className="web-voice-status">语音识别中...</div> : null}
      </div>
      <div className="web-composer-actions">
        {supported ? (
          <button
            type="button"
            className={listening ? 'web-voice-button listening' : 'web-voice-button'}
            onClick={() => {
              if (listening) stop()
              else start()
            }}
            disabled={disabled}
          >
            {listening ? '停止' : '语音'}
          </button>
        ) : null}
        <button onClick={() => void submit()} disabled={disabled || !value.trim()}>
          发送
        </button>
      </div>
    </div>
  )
}
