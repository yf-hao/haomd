import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'

type BrowserFileHandle = {
  name: string
  getFile: () => Promise<File>
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>
}

type BrowserFilePicker = Window & {
  showOpenFilePicker?: (options?: unknown) => Promise<BrowserFileHandle[]>
  showSaveFilePicker?: (options?: unknown) => Promise<BrowserFileHandle>
}

const DRAFT_KEY = 'haomd:browser-documents:draft'

export function BrowserDocumentsWorkspace() {
  const [title, setTitle] = useState('未命名.md')
  const [content, setContent] = useState('')
  const [status, setStatus] = useState('新建或打开 Markdown 文档')
  const [hasDocument, setHasDocument] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [preview, setPreview] = useState(false)
  const [fileHandle, setFileHandle] = useState<BrowserFileHandle | null>(null)
  const fallbackInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const draft = JSON.parse(raw) as { title?: string; content?: string }
      if (typeof draft.content === 'string' && draft.content.length > 0) {
        setTitle(draft.title || '未命名.md')
        setContent(draft.content)
        setHasDocument(true)
        setDirty(true)
        setStatus('已恢复浏览器草稿；仍需保存到文件')
      }
    } catch {
      setStatus('浏览器草稿读取失败')
    }
  }, [])

  useEffect(() => {
    if (!hasDocument) return
    const timeout = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, content }))
      } catch {
        setStatus('浏览器存储空间不足，无法自动保存草稿')
      }
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [content, hasDocument, title])

  const newDocument = () => {
    setTitle('未命名.md')
    setContent('')
    setFileHandle(null)
    setHasDocument(true)
    setDirty(true)
    setPreview(false)
    setStatus('新文档尚未保存')
  }

  const loadFile = async (file: File, handle: BrowserFileHandle | null) => {
    setTitle(file.name)
    setContent(await file.text())
    setFileHandle(handle)
    setHasDocument(true)
    setDirty(false)
    setPreview(false)
    setStatus(handle ? `已打开 ${file.name}` : `已打开 ${file.name}；保存时将下载修改后的文件`)
  }

  const openDocument = async () => {
    const picker = window as BrowserFilePicker
    if (!picker.showOpenFilePicker) {
      fallbackInputRef.current?.click()
      return
    }
    try {
      const [handle] = await picker.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'Markdown 文件', accept: { 'text/markdown': ['.md', '.markdown'] } }],
      })
      if (handle) await loadFile(await handle.getFile(), handle)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('打开文件失败')
    }
  }

  const saveDocument = async () => {
    if (!hasDocument) return
    const picker = window as BrowserFilePicker
    try {
      let handle = fileHandle
      if (!handle && picker.showSaveFilePicker) {
        handle = await picker.showSaveFilePicker({
          suggestedName: title.endsWith('.md') ? title : `${title || '未命名'}.md`,
          types: [{ description: 'Markdown 文件', accept: { 'text/markdown': ['.md'] } }],
        })
      }
      if (handle) {
        const writable = await handle.createWritable()
        await writable.write(content)
        await writable.close()
        setFileHandle(handle)
        setTitle(handle.name)
        setDirty(false)
        setStatus(`已保存到 ${handle.name}`)
        return
      }
      const blobUrl = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = blobUrl
      anchor.download = title.endsWith('.md') ? title : `${title || '未命名'}.md`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
      setDirty(false)
      setStatus('已下载 Markdown 文件')
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('保存失败，请重试')
    }
  }

  return (
    <section className="browser-documents-workspace">
      <header className="browser-documents-toolbar">
        <div className="browser-documents-heading">
          <h1>网页文档</h1>
          {hasDocument ? (
            <input aria-label="文件名" value={title} onChange={(event) => { setTitle(event.target.value); setDirty(true); setStatus('有未保存的更改') }} />
          ) : null}
        </div>
        <div className="browser-documents-actions">
          <button type="button" onClick={newDocument}>新建</button>
          <button type="button" onClick={() => void openDocument()}>打开 Markdown</button>
          {hasDocument ? <button type="button" onClick={() => setPreview((value) => !value)}>{preview ? '编辑' : '预览'}</button> : null}
          {hasDocument ? <button type="button" className="browser-documents-save" onClick={() => void saveDocument()}>保存</button> : null}
          <span className={dirty ? 'browser-documents-status dirty' : 'browser-documents-status'}>{status}</span>
        </div>
      </header>
      <input
        ref={fallbackInputRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        className="browser-documents-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void loadFile(file, null)
          event.target.value = ''
        }}
      />
      {hasDocument ? (
        preview ? (
          <article className="browser-documents-preview markdown-body gh-markdown">
            <ReactMarkdown>{content || '_暂无内容_'}</ReactMarkdown>
          </article>
        ) : (
          <textarea
            className="browser-documents-editor"
            aria-label="Markdown 文档内容"
            value={content}
            placeholder="# 在这里开始写作"
            spellCheck={false}
            onChange={(event) => { setContent(event.target.value); setDirty(true); setStatus('有未保存的更改') }}
          />
        )
      ) : (
        <div className="browser-documents-empty">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
            <path d="M5 2.75h9l5 5v13.5H5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z" />
            <path d="M14 3v5h5M8 13h8M8 17h8" />
          </svg>
          <h2>创建或打开 Markdown 文档</h2>
          <p>草稿会暂存在浏览器中；保存时可写回已授权文件，或下载为 Markdown 文件。</p>
          <div><button type="button" className="browser-documents-save" onClick={newDocument}>新建文档</button><button type="button" onClick={() => void openDocument()}>打开文件</button></div>
        </div>
      )}
      <footer className="browser-documents-footnote">浏览器草稿用于意外关闭后的恢复，不代表文档已保存到文件。</footer>
    </section>
  )
}
