import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

function main() {
  // 1. 读取 app/package.json 的 version
  const appRoot = resolve(new URL('../', import.meta.url).pathname)
  const pkgPath = resolve(appRoot, 'package.json')
  const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const version = pkgJson.version

  if (typeof version !== 'string' || !version) {
    console.error('[sync-version] package.json.version is missing or invalid')
    process.exit(1)
  }

  console.log(`[sync-version] version from package.json: ${version}`)

  // 2. 读取 Cargo.toml
  const cargoPath = resolve(appRoot, 'src-tauri', 'Cargo.toml')
  const cargoText = readFileSync(cargoPath, 'utf8')

  // 3. 替换 version = "xxx"
  const replaced = cargoText.replace(/(^\s*version\s*=\s*")([^"]*)(")/m, `$1${version}$3`)

  if (replaced === cargoText) {
    console.warn('[sync-version] Cargo.toml version line not changed (check regex and file structure)')
  } else {
    console.log('[sync-version] Cargo.toml version updated')
  }

  // 4. 写回 Cargo.toml
  writeFileSync(cargoPath, replaced)
  console.log('[sync-version] done')
}

main()
