# 阶段 1：环境与依赖对齐执行手册

## 背景
- 目标：Tauri 桌面端（Tauri 2.9.x + React + Vite + TS）环境一致，前后端版本对齐，确保 `npm run tauri:dev` 可正常启动。
- 需求出处：`plan.md` 与 `IMPLEMENTATION_PLAN.md` 中的阶段 1。

## 步骤清单
1) **确认版本号（保持同一 2.9.x）**
   - 前端：`@tauri-apps/api`、`@tauri-apps/cli` → 2.9.5（或统一的 2.9.x）
   - 后端：`tauri`、`tauri-build` → 2.9.5（或统一的 2.9.x）

2) **更新前端依赖声明**
   - 编辑 `app/package.json`：
     - `dependencies.@tauri-apps/api` 设为 `2.9.5`
     - `devDependencies.@tauri-apps/cli` 设为 `2.9.5`
   - 保存文件。

3) **更新后端依赖声明**
   - 编辑 `app/src-tauri/Cargo.toml`：
     - `tauri-build = "2.9.5"`
     - `tauri = "2.9.5"`
   - 保存文件。

4) **清理旧锁与缓存**
   - 删除旧锁：`rm -f app/src-tauri/Cargo.lock`
   - 清理构建缓存：`cargo clean --manifest-path app/src-tauri/Cargo.toml`

5) **重新安装前端依赖**
   - `cd /Users/yfhao/Documents/study/markdown/app`
   - `npm install`

6) **验证版本一致性（推荐）**
   - 前端：`npm ls @tauri-apps/api @tauri-apps/cli`
   - 后端：`cargo tree -i tauri --manifest-path src-tauri/Cargo.toml`（确认 tauri/tauri-build 均为 2.9.5）

7) **启动开发模式**
   - 仍在 `app` 目录：`npm run tauri:dev`
   - 若提示版本不匹配，重复 1~6，确保锁文件重建。

8) **常见问题排查**
   - 找不到 Cargo.toml：命令需 `--manifest-path app/src-tauri/Cargo.toml` 或先 `cd app/src-tauri`。
   - 版本 mismatch：确认 `package.json` 与 `Cargo.toml` 均为同一 2.9.x；重新安装并清理 Cargo 缓存。
   - 构建仍失败：收集完整 `npm run tauri:dev` 输出及 `src-tauri/target` 下的构建日志，再行排查。

## 完成判定
- `npm run tauri:dev` 可正常启动，未再出现版本不匹配或缺失依赖错误。
- `npm ls @tauri-apps/api @tauri-apps/cli` 与 `cargo tree -i tauri` 显示版本一致（2.9.x）。
