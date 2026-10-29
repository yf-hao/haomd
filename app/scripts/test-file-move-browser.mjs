import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { dirname, resolve, extname, join } from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core')
// Exercise the production UI and Worker with an isolated in-memory native file port.
// Run bun run build first. Native filesystem recovery is covered by Rust tests.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist')
const artifacts = await mkdtemp(join(tmpdir(), 'haomd-file-move-browser-'))
const richText = process.env.MOVE_EDITOR === 'wysiwyg'
const cleanMove = process.env.MOVE_CLEAN === '1'
const backgroundMove = process.env.MOVE_BACKGROUND === '1'
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  if (pathname === '/test-image') {
    res.setHeader('Content-Type', 'image/svg+xml')
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><rect width="60" height="40" fill="green"/></svg>')
    return
  }
  const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return }
  try {
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(path)] ?? 'application/octet-stream')
    res.end(await readFile(path))
  } catch { res.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const failures = []
page.on('pageerror', error => failures.push(error.message))
await page.addInitScript(({ richText }) => {
  localStorage.setItem('haomd:editMode', richText ? 'wysiwyg' : 'source')
  const oldPath = '/workspace/草稿/笔记.md'
  const newPath = '/workspace/归档/笔记01.md'
  const documents = {
    [oldPath]: '![image](images/图%20片.png)\n\n[原资源](docs/ref.md)\n\n正文',
    '/workspace/index.md': '[笔记](草稿/笔记.md)',
    '/workspace/归档/笔记.md': '已有文件，不得覆盖',
  }
  const calls = []
  const snapshot = path => ({ path, content: documents[path], hash: 'hash-' + documents[path], mtimeMs: 1 })
  window.moveTest = { calls, documents, oldPath, newPath, committing: false }
  const NativeWorker = Worker
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options)
      this.addEventListener('error', event => { window.moveTest.workerError = { message: event.message, filename: event.filename, lineno: event.lineno } })
    }
  }
  const ok = data => ({ Ok: { data, trace_id: 'test' } })
  let callback = 0
  const callbacks = new Map()
  const listeners = new Map()
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event, id) => listeners.delete(id) }
  window.moveTest.menu = payload => { for (const { event, handler } of listeners.values()) if (event === 'menu://action') callbacks.get(handler)?.({ event, payload, id: 0 }) }
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: fn => { callbacks.set(++callback, fn); return callback },
    unregisterCallback: id => callbacks.delete(id),
    convertFileSrc: path => location.origin + '/test-image?path=' + encodeURIComponent(path),
    invoke: async (command, args = {}) => {
      calls.push({ command, args })
      if (command === 'plugin:event|listen') { const id = ++callback; listeners.set(id, args); return id }
      if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return }
      if (command.startsWith('plugin:event|')) return
      if (command.startsWith('plugin:window|') || command.startsWith('plugin:webview|')) return false
      if (command === 'load_editor_settings') return ok({})
      if (command === 'load_sidebar_state') return ok({ root: '/workspace', folder_roots: ['/workspace'],
        expanded_paths: ['/workspace', '/workspace/草稿', '/workspace/归档'], standalone_files: [], highlighted_files: [] })
      if (command === 'list_folder') return ok([
        { path: '/workspace/草稿', name: '草稿', kind: 'dir' }, { path: '/workspace/归档', name: '归档', kind: 'dir' },
        ...Object.keys(documents).map(path => ({ path, name: path.split('/').pop(), kind: 'file' })),
      ])
      if (command === 'read_file') {
        if (!(args.path in documents)) throw new Error('missing: ' + args.path)
        const item = snapshot(args.path)
        return ok({ ...item, mtime_ms: item.mtimeMs, encoding: 'utf-8' })
      }
      if (command === 'prepare_file_move') return ok({ operationId: 'move-1', oldPath, newPath,
        documents: [snapshot(oldPath)] })
      if (command === 'commit_file_move') {
        window.moveTest.committing = true
        await new Promise(resolve => setTimeout(resolve, 600))
        const updates = args.patches.map(patch => {
          const path = patch.path === oldPath ? newPath : patch.path
          documents[path] = patch.content
          return snapshot(path)
        })
        if (!updates.some(item => item.path === newPath)) { documents[newPath] = documents[oldPath]; updates.push(snapshot(newPath)) }
        delete documents[oldPath]
        return ok({ oldPath, newPath, documents: updates, reconciliationRequired: false })
      }
      if (command === 'write_file' || command === 'write_file_no_recent') {
        if (args.expected_hash && args.expected_hash !== 'hash-' + documents[args.path]) return { Err: { error: { code: 'CONFLICT', message: 'Stale file version' } } }
        documents[args.path] = args.content
        return ok({ path: args.path, hash: 'hash-' + args.content, mtime_ms: 1, code: 'OK' })
      }
      if (['load_file_virtual_folders', 'list_file_virtual_assignments', 'list_recent', 'list_pdf_recent', 'list_notes', 'load_pdf_folders'].includes(command)) return ok([])
      if (/^(save_|set_|log_|cancel_|update_)/.test(command)) return ok(null)
      return { Err: { error: { code: 'UNSUPPORTED', message: 'Test fixture: ' + command } } }
    },
  }
}, { richText })
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.locator('.activity-item').first().click()
  await page.locator('[data-file-source="/workspace/草稿/笔记.md"]').waitFor()
  await page.locator('[data-file-source="/workspace/草稿/笔记.md"]').click()
  const editorSelector = richText ? '.ProseMirror[contenteditable=true]' : '.cm-content'
  await page.locator(editorSelector).waitFor()
  await page.waitForTimeout(600)
  if (backgroundMove) {
    await page.locator('[data-file-source="/workspace/index.md"]').click()
    await page.waitForTimeout(300)
  }
  await writeFile(join(artifacts, 'dom.txt'), await page.locator('body').innerText())
  const source = page.locator('[data-file-source="/workspace/草稿/笔记.md"]')
  const target = page.locator('[data-file-directory="/workspace/归档"]')
  const from = await source.boundingBox(), to = await target.boundingBox()
  await page.mouse.move(from.x + 60, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + 50, to.y + to.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.waitForFunction(() => window.moveTest.committing)
  if (!cleanMove) {
    await page.locator(editorSelector).click()
    await page.keyboard.press('Meta+End')
    await page.keyboard.insertText(' 移动期间新增')
  }
  await page.locator('[data-file-source="/workspace/归档/笔记01.md"]').waitFor()
  await page.waitForTimeout(300)
  const editor = await page.locator(editorSelector).innerText()
  if ((!cleanMove && !editor.includes('移动期间新增')) || (!richText && !backgroundMove && (!editor.includes('../') || !editor.includes('images/')))) throw new Error('Relocated editor content lost: ' + editor)
  const images = await page.locator(richText ? '.ProseMirror img[src]' : '.markdown-body img[src]').evaluateAll(images => images.map(image => ({ src: image.src, width: image.naturalWidth })))
  if (!backgroundMove && (!images.length || images.some(image => image.width === 0 || !decodeURIComponent(image.src).includes('/workspace/草稿/images/图 片.png')))) throw new Error('Preview image points at wrong resource: ' + JSON.stringify(images))
  if (!richText && !backgroundMove) {
    const links = await page.locator('.markdown-body a').evaluateAll(links => links.map(link => link.href))
    if (!links.some(href => decodeURIComponent(href) === 'file:///workspace/草稿/docs/ref.md')) throw new Error('Preview link points at wrong resource: ' + links)
  }
  if (await page.locator('.tab-bar-list .tab-dirty-dot').count() !== (cleanMove ? 0 : 1)) throw new Error('Wrong dirty state after moving')
  const beforeSave = await page.evaluate(() => ({ ...window.moveTest, calls: window.moveTest.calls.slice(-15) }))
  await page.evaluate(() => window.moveTest.menu('save'))
  await page.waitForFunction(() => window.moveTest.calls.some(call => call.command === 'write_file'))
  const result = await page.evaluate(() => ({ documents: window.moveTest.documents,
    saves: window.moveTest.calls.filter(call => call.command === 'write_file'),
    commits: window.moveTest.calls.filter(call => call.command === 'commit_file_move'),
  }))
  if (result.saves.at(-1).args.path !== (backgroundMove ? '/workspace/index.md' : '/workspace/归档/笔记01.md')) throw new Error('Save used old path')
  if (result.documents['/workspace/归档/笔记.md'] !== '已有文件，不得覆盖') throw new Error('Overwrote occupied target')
  if (!backgroundMove && result.documents['/workspace/index.md'] !== '[笔记](草稿/笔记.md)') throw new Error('Unrelated document was modified')
  if (backgroundMove && (result.documents['/workspace/index.md'].includes('01.md') || (!cleanMove && !result.documents['/workspace/index.md'].includes('移动期间新增')))) throw new Error('Active unrelated document was overwritten')
  if (result.commits.some(call => call.args.patches.some(patch => patch.path !== '/workspace/草稿/笔记.md'))) throw new Error('Submitted an unrelated document patch')
  await page.screenshot({ path: join(artifacts, 'screenshot.png') })
  console.log(JSON.stringify({ artifacts, editorMode: richText ? 'wysiwyg' : 'source', cleanMove, backgroundMove, editor, result, failures, beforeSave: beforeSave.documents }, null, 2))
} catch (error) {
  await writeFile(join(artifacts, 'dom.txt'), await page.locator('body').innerText())
  console.error(error)
  console.error('Page errors:', failures)
  console.error('Recent commands:', await page.evaluate(() => ({ workerError: window.moveTest?.workerError, calls: window.moveTest?.calls.filter(c => /file|folder|save/.test(c.command)).slice(-20) })))
  process.exitCode = 1
} finally { await browser.close(); server.close() }
