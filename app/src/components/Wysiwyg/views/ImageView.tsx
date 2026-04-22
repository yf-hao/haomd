/**
 * Custom image node view for Milkdown WYSIWYG editor.
 * Resolves local file paths to haomd:// protocol URLs.
 */
import { memo, useEffect, useMemo, useState } from 'react'
import { useNodeViewContext } from '@prosemirror-adapter/react'

/**
 * Resolve a relative image path to a haomd:// or https://haomd.localhost URL.
 */
function resolveImageSrc(src: string, filePath?: string | null): string {
  if (!src) return src
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
    return src
  }
  if (!filePath) return src

  const fileDir = filePath.replace(/[/\\][^/\\]+$/, '')
  const sep = filePath.includes('\\') ? '\\' : '/'
  let absPath = src

  if (src.startsWith('.')) {
    const parts = src.split(/[/\\]/)
    let dir = fileDir
    for (const part of parts) {
      if (part === '..') dir = dir.replace(/[/\\][^/\\]+$/, '')
      else if (part !== '.') dir = dir + sep + part
    }
    absPath = dir
  } else if (!src.match(/^[a-zA-Z]:/)) {
    absPath = fileDir + sep + src
  }

  const pathParts = absPath.split(/([/\\])/)
  const encodedParts = pathParts.map((part: string) =>
    part === '/' || part === '\\' ? part : encodeURIComponent(part),
  )
  const encoded = encodedParts.join('')
  const isWindows = filePath.includes('\\') || navigator.userAgent.includes('Windows')
  return isWindows ? `https://haomd.localhost${encoded}` : `haomd://localhost${encoded}`
}

interface ImageViewProps {
  filePath?: string | null
}

export const ImageView = memo(function ImageView({ filePath }: ImageViewProps) {
  const { node, selected } = useNodeViewContext()
  const src = (node.attrs.src as string) || ''
  const alt = (node.attrs.alt as string) || ''
  const title = (node.attrs.title as string) || ''

  // Parse width from alt text like "alt(100px)" or "alt(50%)"
  const widthMatch = /\(([\d.]+(?:px|%|rem|vw))\)$/.exec(alt)
  const maxWidth = widthMatch ? widthMatch[1] : undefined
  const cleanAlt = alt.replace(/\(([\d.]+(?:px|%|rem|vw))\)$/, '').trim()

  const resolvedSrc = useMemo(() => resolveImageSrc(src, filePath), [src, filePath])
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    setLoadFailed(false)
  }, [resolvedSrc])

  // Detect audio/video by alt or extension
  const lowerAlt = cleanAlt.toLowerCase()
  const isAudio = lowerAlt === 'audio' || lowerAlt === '音频' || /\.(mp3|wav|m4a|ogg|flac)$/i.test(src)
  const isVideo = lowerAlt === 'video' || lowerAlt === '视频' || /\.(mp4|webm|mov|ogg|ogv)$/i.test(src)

  if (isAudio) {
    return (
      <span className={`wysiwyg-media ${selected ? 'selected' : ''}`} contentEditable={false}>
        <audio controls src={resolvedSrc} style={{ width: maxWidth || '100%', display: 'block', margin: '0 auto' }}>
          您的浏览器不支持 audio 标签。
        </audio>
      </span>
    )
  }

  if (isVideo) {
    return (
      <span className={`wysiwyg-media ${selected ? 'selected' : ''}`} contentEditable={false}>
        <video controls preload="metadata" src={resolvedSrc} style={{ width: maxWidth || '100%', maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto' }}>
          您的浏览器不支持 video 标签。
        </video>
      </span>
    )
  }

  if (loadFailed) {
    return (
      <span className={`wysiwyg-image ${selected ? 'selected' : ''}`} contentEditable={false}>
        <span
          style={{
            maxWidth: maxWidth || '100%',
            minHeight: 56,
            display: 'block',
            margin: '0 auto',
            padding: '12px 14px',
            borderRadius: 6,
            border: '1px dashed rgba(255,255,255,0.2)',
            color: 'var(--theme-text-muted, #8b949e)',
            background: 'color-mix(in srgb, var(--theme-bg-secondary, #161b22) 76%, transparent)',
            fontSize: 13,
            lineHeight: 1.5,
            boxSizing: 'border-box',
          }}
        >
          <strong style={{ display: 'block', color: 'var(--theme-text-default, #c9d1d9)', marginBottom: 4 }}>
            图片未找到
          </strong>
          <span>{cleanAlt || src || '未提供图片路径'}</span>
        </span>
      </span>
    )
  }

  return (
    <span className={`wysiwyg-image ${selected ? 'selected' : ''}`} contentEditable={false}>
      <img
        src={resolvedSrc}
        alt={cleanAlt}
        title={title || undefined}
        loading="lazy"
        style={{
          maxWidth: maxWidth || '100%',
          height: 'auto',
          display: 'block',
          margin: '0 auto',
          borderRadius: 4,
        }}
        onError={() => {
          setLoadFailed(true)
        }}
      />
    </span>
  )
})
