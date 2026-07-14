# 发布流程

这份文档记录 HaoMD 的标准发布步骤，后续每次发版都按这里执行。

## 适用范围

- 适用于从 `main` 分支触发的正式发布
- 适用于 `app/package.json` 中的版本号发布
- 适用于 GitHub Actions 自动构建和上传安装包

## 发布前准备

1. 确认本次改动已经完成并通过自测。
2. 更新 `CHANGELOG.md` 顶部的最新版本块，确保它是完整的发布说明。
3. 将 `app/package.json` 的版本号更新到目标版本，例如 `0.12.4`。
4. 同步 `app/src-tauri/Cargo.toml` 的版本号。

### 同步版本号

在 `app/` 目录下执行：

```bash
npm run sync-version
```

这个脚本会把 `app/package.json` 的 `version` 同步到 `app/src-tauri/Cargo.toml`。

## 发布步骤

1. 检查版本文件和 changelog。
2. 提交改动到 `main` 分支。
3. 推送到远端仓库。
4. 等待 GitHub Actions 的 `Release` workflow 自动运行。

### 推荐提交内容

- `app/package.json`
- `app/src-tauri/Cargo.toml`
- `app/src-tauri/Cargo.lock`
- `CHANGELOG.md`
- 其他本次发布相关的代码文件

### 推送命令

```bash
git add app/package.json app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock CHANGELOG.md RELEASE.md
git commit -m "Prepare v0.12.4 release"
git push origin main
```

## GitHub Actions 发布逻辑

仓库的 `.github/workflows/release.yml` 会在 `main` 分支 push 后执行：

1. 读取 `app/package.json` 的版本号。
2. 检查对应的 tag `v<version>` 是否已存在。
3. 如果 tag 不存在，提取 `CHANGELOG.md` 顶部版本块。
4. 使用 `tauri-apps/tauri-action` 构建并创建 GitHub Release。

### 产物说明

- macOS Apple Silicon: `*_aarch64.dmg`
- macOS Intel: `*_x64.dmg`
- Windows: `*_x64-setup.exe`
- Linux Debian/Ubuntu: `*.deb`
- Linux AppImage: `*.AppImage`

## 发布检查清单

- `app/package.json` 版本号已更新
- `app/src-tauri/Cargo.toml` 版本号已同步
- `app/src-tauri/Cargo.lock` 已随同步更新
- `CHANGELOG.md` 顶部版本说明完整
- 工作区没有不相关的脏改动
- 已提交并推送到 `main`
- GitHub Actions 发布成功

## 常见问题

### 1. 为什么没有触发 Release

- 先检查 `app/package.json` 的版本号是否真的发生变化。
- 再检查远端是否已经存在同名 tag `v<version>`。
- Workflow 只会在 `main` 分支 push 后自动执行。

### 2. 为什么 release body 是空的

- `scripts/extract-changelog.mjs` 只会提取 `CHANGELOG.md` 中最上方的第一个版本块。
- 确保第一段版本标题格式是：

```md
## [v0.12.4] - 2026-07-14
```

### 3. 版本号不同步怎么办

- 重新运行：

```bash
cd app
npm run sync-version
```

- 然后重新提交 `app/src-tauri/Cargo.toml` 和 `app/src-tauri/Cargo.lock`

## 版本命名建议

- 补丁修复用 `x.y.z` 的末位递增，例如 `0.12.3 -> 0.12.4`
- 如果包含明显的新能力或较大行为变化，再考虑升到下一个小版本

