import React, { memo } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useResolvedThemeMode } from '../modules/theme/ThemeContext'
import { useI18n } from '../modules/i18n/I18nContext'

type CodeBlockProps = {
  lang?: string
  content: string
  className?: string
  showCopyButton?: boolean
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // ignore and fallback to execCommand
    }
  }

  if (typeof document === 'undefined') {
    return false
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)

  const selection = document.getSelection()
  const originalRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null

  textarea.select()

  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }

  document.body.removeChild(textarea)

  if (originalRange && selection) {
    selection.removeAllRanges()
    selection.addRange(originalRange)
  }

  return ok
}

const CodeBlock = memo(
  ({ lang, content, showCopyButton = true, ...rest }: CodeBlockProps) => {
    const { t } = useI18n()
    const [copied, setCopied] = React.useState(false)
    const themeMode = useResolvedThemeMode()

    const handleCopy = async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      const ok = await copyTextToClipboard(content)
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => {
        setCopied(false)
      }, 1200)
    }

    return (
      <div className="code-block-wrapper">
        {showCopyButton ? (
          <button
            type="button"
            className={`code-copy-button${copied ? ' copied' : ''}`}
            onClick={handleCopy}
            aria-label={copied ? t('editor.copiedCode') : t('editor.copyCode')}
          >
            {copied ? t('editor.copied') : t('editor.copy')}
          </button>
        ) : null}
        <SyntaxHighlighter
          language={lang}
          style={themeMode === 'light' ? oneLight : oneDark}
          showLineNumbers
          wrapLines
          customStyle={{
            fontSize: 'var(--markdown-code-font-size, inherit)',
          }}
          codeTagProps={{
            style: {
              fontSize: 'var(--markdown-code-font-size, inherit)',
            },
          }}
          {...rest}
        >
          {content}
        </SyntaxHighlighter>
      </div>
    )
  },
  (prev, next) =>
    prev.lang === next.lang &&
    prev.content === next.content &&
    prev.className === next.className &&
    prev.showCopyButton === next.showCopyButton,
)

export default CodeBlock
