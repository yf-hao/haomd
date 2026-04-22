# Copilot Instructions

## Build, test, and lint

Most active development commands live in `app/`, not the repository root.

```bash
cd app
npm install
npm run tauri:dev
npm run build
npm run tauri:build
npm run lint
npm run type-check
npm run test:run
npm run test:coverage
```

Run a single test file with Vitest:

```bash
cd app
npm run test:run -- src/modules/files/service.test.ts
```

Run tests by name:

```bash
cd app
npm run test:run -- -t "loads AI settings"
```

From the repository root, `npm test` and `npm run test:ci` are only thin wrappers around the `app/` Vitest commands.

## High-level architecture

- `app/` is the main product. It builds two entry points from one Vite app: the desktop Tauri app (`src/main.tsx` -> `App.tsx`) and a web-lite client (`src/main.web.tsx` -> `src/web/AppWeb.tsx`).
- `App.tsx` owns global UI/runtime concerns such as theme resolution, language resolution, top-level dialogs, and status state. `components/WorkspaceShell.tsx` is the main desktop orchestrator: it wires tabs, file persistence, sidebar state, preview/layout switching, PDF, AI chat, huge-document handling, and source/WYSIWYG editing.
- Most feature logic lives under `app/src/modules/**` and `app/src/hooks/**`; React components are usually composition/UI shells over those services and hooks. For AI, skills, workflows, files, export, and settings work, start in `modules/` before editing components.
- `app/src-tauri/src/lib.rs` is the backend command surface. It registers file I/O, settings persistence, AI/session storage, export helpers, MCP server management, and workspace operations. TypeScript services call these commands via `invoke(...)` wrappers rather than embedding backend details directly in components.
- The web-lite app under `app/src/web/**` is not just a view layer for Tauri. It has its own storage and sync flow for chat, notes, settings, import/export, and WebDAV. Shared code that may run in both runtimes should keep the `isTauriEnv()` boundary intact.

## Key conventions

- Frontend/backend data shapes are intentionally adapted at the boundary. Rust/Tauri payloads use snake_case and `BackendResult<T>`-style responses; frontend services map them into camelCase app types and normalized result/error objects. Prefer extending an existing service/repo module such as `modules/files/service.ts` or `modules/ai/config/*.ts` instead of calling `invoke` directly from UI code.
- Tests are colocated with implementation as `*.test.ts` / `*.test.tsx`, and Vitest runs in `jsdom`. When adding coverage, follow the nearby file’s test placement instead of creating a separate top-level test tree.
- Heavy UI surfaces are intentionally lazy-loaded from `WorkspaceShell` (`EditorPane`, `PreviewPane`, PDF viewer, AI panes/dialogs, WYSIWYG), and Vite chunking is manually tuned in `app/vite.config.ts`. Preserve those lazy boundaries when changing large editor/preview/AI/PDF features.
- User-facing strings are maintained in both `app/src/modules/i18n/messages/zh-CN.ts` and `app/src/modules/i18n/messages/en-US.ts`. `translateMessage(...)` falls back to English when a locale key is missing, so new UI copy should usually be added to both catalogs together.
- Markdown behavior includes repo-specific extensions in `app/src/modules/markdown/`. For example, text color is represented as `{color:#hex}...{/color}` and transformed through dedicated helpers in `modules/markdown/extensions/colorMark.ts`; do not replace these features with ad-hoc raw HTML handling.
- Workspace-writing AI tools are constrained to mounted workspace roots. If you touch AI tool definitions or workspace file actions, preserve the existing mounted-root resolution and “do not write outside mounted roots” behavior in `modules/workspace/workspaceBuiltinTool.ts` and the matching Tauri commands.

## MCP servers

- For browser automation, Playwright is the most relevant MCP server for this repo. Use it against the Vite web entry points in `app/`, especially `web-lite.html` for the web-lite client and `index.html` for shared frontend behavior.
- A typical browser automation loop is:

```bash
cd app
npm run dev
```

- Then drive `http://localhost:5173/web-lite.html` for web-lite flows. Prefer this for validating shared React/UI behavior; Tauri-native integration still needs the desktop runtime and cannot be fully covered by plain browser automation alone.
