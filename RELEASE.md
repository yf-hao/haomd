# HaoMD 发布流程

本文档记录 HaoMD 的正式发布流程。项目发布由 GitHub Actions 自动完成。

## 一、发布机制

`.github/workflows/release.yml` 监听 `main` 分支的 push：

1. 读取 `app/package.json` 中的版本号。
2. 生成对应标签 `v<version>`。
3. 检查远端是否已经存在该标签。
4. 如果标签不存在，提取 `CHANGELOG.md` 顶部的版本说明。
5. 构建各平台安装包并创建 GitHub Release。

因此，发布新版本的核心操作是：**更新版本号和变更日志，然后将提交推送到 `main` 分支**。

## 二、版本号规则

- 修复问题或小幅优化：递增补丁版本，例如 `0.12.9` → `0.12.10`。
- 增加较大功能或包含较大行为变化：递增次版本，例如 `0.12.9` → `0.13.0`。
- 不要提前手动创建对应的 Git 标签，否则 CI 会认为该版本已经发布并跳过发布。

## 三、发布前准备

### 1. 更新版本号

在 `app` 目录执行：

```bash
cd app
npm version 0.13.0 --no-git-tag-version
```

将示例中的 `0.13.0` 替换为实际发布版本。该命令会更新 `app/package.json` 和 `app/package-lock.json`，且不会自动创建 Git 标签。

### 2. 同步 Tauri 版本

```bash
npm run sync-version
```

该脚本会把 `app/package.json` 的版本号同步到 `app/src-tauri/Cargo.toml`。

### 3. 更新变更日志

在根目录 `CHANGELOG.md` 顶部增加最新版本块，格式如下：

```md
## [v0.13.0] - 2026-09-06

### 中文

本次更新说明。

#### 主要更新

* **功能或修复**：具体说明。

### English

Release summary.

#### Key Updates

* **Feature or Fix**: Details.
```

最新版本块必须放在文件最上方。发布脚本 `scripts/extract-changelog.mjs` 只会提取顶部的版本块作为 GitHub Release 的说明。

## 四、本地检查

在提交前执行：

```bash
npm run type-check --prefix app
npm run test:run --prefix app
npm run build --prefix app
```

如果需要验证完整的 Tauri 构建，再执行：

```bash
npm run tauri:build --prefix app
```

## 五、提交并推送

确认版本文件、变更日志和代码都正确后：

```bash
git status
git add app/package.json app/package-lock.json app/src-tauri/Cargo.toml CHANGELOG.md
git commit -m "chore: release v0.13.0"
git push origin main
```

如果 `app/src-tauri/Cargo.lock` 因构建或依赖变化发生修改，也应一并提交：

```bash
git add app/src-tauri/Cargo.lock
```

提交信息中的版本号应与 `app/package.json` 保持一致。

## 六、CI 自动生成的发布产物

推送到 `main` 后，GitHub Actions 会构建并发布：

- macOS Apple Silicon：`*_aarch64.dmg`
- macOS Intel：`*_x64.dmg`
- Windows：`*_x64-setup.exe`
- Linux Debian/Ubuntu：`*.deb`
- Linux AppImage：`*.AppImage`

Release 名称格式为：

```text
HaoMD v0.13.0
```

## 七、发布后检查

在 GitHub 仓库中确认：

1. `Release` workflow 执行成功。
2. `v<version>` 标签已经生成。
3. GitHub Release 已创建。
4. macOS、Windows 和 Linux 安装包均已上传。
5. 至少在目标平台安装并启动一次，确认应用可以正常打开。

## 八、常见问题

### 没有触发发布

检查以下内容：

- 是否推送到了 `main` 分支；
- `app/package.json` 的版本号是否发生变化；
- 远端是否已经存在同名标签；
- GitHub Actions 是否因为 CI 检查失败而中断。

### Release 说明为空

检查 `CHANGELOG.md`：

- 最新版本块是否位于文件顶部；
- 标题是否使用 `## [vX.Y.Z] - YYYY-MM-DD` 格式；
- 版本号是否与 `app/package.json` 一致。

### 应用显示的版本号没有更新

重新执行：

```bash
cd app
npm run sync-version
```

确认 `app/src-tauri/Cargo.toml` 已同步修改，然后重新提交并推送。
