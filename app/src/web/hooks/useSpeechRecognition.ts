import { useEffect, useRef, useState } from 'react'

type SpeechRecognitionCtor = new () => {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: {
    results: ArrayLike<ArrayLike<{ transcript: string }>>
    resultIndex: number
  }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const withRecognition = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return withRecognition.SpeechRecognition ?? withRecognition.webkitSpeechRecognition ?? null
}

export function useSpeechRecognition(options: {
  lang?: string
  onResult: (text: string) => void
}) {
  const recognitionRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null)
  const [supported] = useState(() => !!getSpeechRecognitionCtor())
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
      recognitionRef.current = null
    }
  }, [])

  const start = () => {
    const Recognition = getSpeechRecognitionCtor()
    if (!Recognition) {
      setError('当前浏览器不支持语音识别')
      return
    }

    recognitionRef.current?.stop()
    const recognition = new Recognition()
    recognition.lang = options.lang ?? 'zh-CN'
    recognition.interimResults = true
    recognition.continuous = false
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .slice(event.resultIndex)
        .flatMap((result) => Array.from(result))
        .map((item) => item.transcript)
        .join('')
        .trim()
      if (transcript) options.onResult(transcript)
    }
    recognition.onerror = (event) => {
      setError(event.error || '语音识别失败')
      setListening(false)
    }
    recognition.onend = () => {
      setListening(false)
    }
    recognitionRef.current = recognition
    setError(null)
    setListening(true)
    recognition.start()
  }

  const stop = () => {
    recognitionRef.current?.stop()
    setListening(false)
  }

  return {
    supported,
    listening,
    error,
    start,
    stop,
    clearError: () => setError(null),
  }
}
