# 安装与启动指南（Tauri 2.9.1 + React + Vite）

## 前置要求
- Node.js 18+ 与 npm
- Rust toolchain（建议 `rustup default stable`），macOS 需 `xcode-select --install`

## 步骤
1. 进入项目
   ```bash
   cd /Users/yfhao/Documents/study/markdown/app
   ```
2. 安装前端依赖
   ```bash
   npm install
   ```
3. 清理 Tauri 构建缓存（可选但推荐）
   ```bash
   cargo clean --manifest-path src-tauri/Cargo.toml
   ```
4. 开发模式运行
   ```bash
   npm run tauri:dev
   ```
5. 生产构建
   ```bash
   npm run tauri:build
   ```

## 版本对齐（出现版本不匹配时执行）
- 前端 `package.json`
  - `@tauri-apps/api`: 2.9.1
  - `@tauri-apps/cli`: 2.9.1
- 后端 `src-tauri/Cargo.toml`
  - `tauri`: 2.9.1
  - `tauri-build`: 2.5.1
- 重新安装与清理
  ```bash
  rm -f src-tauri/Cargo.lock
  npm install
  cargo clean --manifest-path src-tauri/Cargo.toml
  ```
- 再次启动 `npm run tauri:dev`

## 故障排查
- **缺少脚本**：确认 `package.json` 中有 `tauri:dev`/`tauri:build`。
- **找不到 Cargo.toml**：命令需带 `--manifest-path src-tauri/Cargo.toml` 或先 `cd app/src-tauri`。
- **版本 mismatch**：确保前后端均为 2.9.1（或同一 2.9.x），删锁文件后重装。
