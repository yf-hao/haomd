import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = await mkdtemp(join(tmpdir(), 'haomd-input-benchmark-'))
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core')
await build({ root, configFile: false, plugins: [react()], logLevel: 'error',
  build: { outDir, emptyOutDir: false, lib: {
    entry: join(root, 'scripts/perf/editor-input.tsx'), formats: ['es'], fileName: () => 'benchmark.js',
  } }, define: { 'process.env.NODE_ENV': '"production"' },
})
await writeFile(join(outDir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="/HaoMD.css"></head><body><div id="root"></div><script type="module" src="/benchmark.js"></script></body></html>')
const server = createServer(async (req, res) => {
  const file = resolve(outDir, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]))
  if (!file.startsWith(outDir + sep)) { res.writeHead(403).end(); return }
  try {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream')
    res.end(await readFile(file))
  } catch { res.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
const results = []
try {
  const sizes = process.env.BENCHMARK_SIZES?.split(',').map(Number) ?? [10_000, 100_000, 500_000, 1_000_000]
  for (const size of sizes) {
    for (const preview of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      page.on('pageerror', error => process.stderr.write(error.message + '\n'))
      await page.goto(`http://127.0.0.1:${server.address().port}/`)
      await page.waitForFunction(() => window.editorBenchmark)
      await page.evaluate(({ size, preview }) => window.editorBenchmark.setup(size, preview), { size, preview })
      const profiler = process.env.BENCHMARK_PROFILE ? await page.context().newCDPSession(page) : null
      if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start') }
      for (let index = 0; index < 30; index++) {
        await page.evaluate(() => window.editorBenchmark.type())
        await page.waitForTimeout(40)
      }
      await page.waitForTimeout(500)
      const result = { size, preview, ...await page.evaluate(() => window.editorBenchmark.results()) }
      results.push(result)
      process.stdout.write(JSON.stringify(result) + '\n')
      if (profiler) {
        const { profile } = await profiler.send('Profiler.stop')
        await writeFile(join(outDir, `profile-${size}-${preview}.json`), JSON.stringify(profile))
        process.stdout.write(`CPU profile: ${outDir}/profile-${size}-${preview}.json\n`)
      }
      await page.close()
    }
  }
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(results, null, 2) + '\n')
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
