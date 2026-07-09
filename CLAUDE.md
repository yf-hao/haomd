# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HaoMD is a high-performance, cross-platform Markdown editor built with Tauri 2 + React + TypeScript. It features real-time preview, AI assistant integration, visualization tools, multi-tab editing, and offline-first experience.

## Architecture

The application has two main components:

1. **Frontend (app/)**: React + TypeScript + Vite application with:
   - CodeMirror 6 as the editor core
   - ReactMarkdown with remark/rehype plugins for rendering
   - KaTeX for math formulas
   - Mermaid and Mind Elixir for diagrams
   - Custom hooks for AI integration, file operations, and workspace management

2. **Backend (app/src-tauri/)**: Rust-based Tauri application with:
   - File system operations (read/write with conflict detection)
   - Menu management
   - Clipboard handling
   - PDF management
   - Settings persistence

## Key Features

- **AI Assistant**: Supports multiple providers (Dify, OpenAI-compatible, vision-enabled providers) with document chat, selection chat, and global memory
- **File Management**: Multi-tab editing, recent files, file browser, PDF viewer
- **Visualization**: Math formulas (KaTeX), diagrams (Mermaid), mind maps (Mind Elixir)
- **Media Support**: Audio/video/image embedding with playback capabilities
- **Large File Support**: Chunked editing for large documents with conflict detection

## Development Commands

### Setup
```bash
cd app
npm install
# or
bun install
```

### Development
```bash
npm run tauri:dev
# or
bun run tauri:dev
```

### Build
```bash
npm run tauri build
# or
bun run tauri build
```

### Testing
```bash
npm run test          # Run tests in watch mode
npm run test:run      # Run tests once
npm run test:coverage # Run tests with coverage
```

### Linting
```bash
npm run lint
```

## Key Files and Directories

- `app/src/App.tsx` - Main application component
- `app/src/components/WorkspaceShell.tsx` - Main workspace layout and management
- `app/src/modules/ai/` - AI assistant related functionality
- `app/src/modules/files/service.ts` - File operations API
- `app/src/modules/markdown/plugins.ts` - Markdown rendering plugins
- `app/src-tauri/src/lib.rs` - Tauri backend commands
- `app/src-tauri/Cargo.toml` - Rust dependencies

## Tauri Commands

The backend exposes several Tauri commands for file operations, including:
- `read_file` - Read a file with conflict detection
- `write_file` - Write a file with mtime/hash validation
- `list_recent` - Get recent files list
- `list_folder` - List directory contents
- `delete_fs_entry` - Delete a file or directory

## AI Integration

The AI system supports multiple providers with different capabilities:
- Dify for custom AI workflows
- OpenAI-compatible APIs
- Vision-enabled providers for image analysis
- Local storage-based session management

## AI Runtime Entry

HaoMD's own AI entry layer should live in the user data directory, next to `recent.json`, not in the source tree.

Final runtime layout:

```text
/Users/yfhao/Library/Application Support/haomd/
├── recent.json
└── ai/
    ├── agent.md
    ├── profile/
    │   ├── user.md
    │   └── communication.md
    ├── workspace/
    │   └── workspace.md
    ├── skills/
    │   ├── index.md
    │   ├── builtin/
    │   └── user/
    ├── memory/
    │   └── observations.md
    ├── records/
    │   └── daily/
    └── jobs/
        └── ai_heartbeat/
```

File responsibilities:

- `agent.md` - The top-level AI entry file. It defines the operating rules, reading order, and how the rest of the `ai/` tree is interpreted.
- `profile/user.md` - The user's identity, preferences, timezone, and communication constraints.
- `profile/communication.md` - Reply style, interaction rules, default decision policy, and when the agent should pause for confirmation.
- `workspace/workspace.md` - Project routing rules: where code, docs, memory, skills, and temporary files live.
- `skills/index.md` - The skill catalog index. It lists available skills, their purpose, and whether they are enabled or trusted.
- `skills/builtin/` - Built-in HaoMD skill specifications that ship with the app.
- `skills/user/` - User-created or user-customized skills.
- `memory/observations.md` - Long-term memory summary: recurring issues, confirmed preferences, and important decisions.
- `records/daily/` - Daily records and lightweight operational notes.
- `jobs/ai_heartbeat/` - Optional automation outputs for future observer / reflector style jobs.

Implementation rule:

- Keep the source of truth for the AI entry layer in markdown files.
- Keep the files adjacent to `recent.json` in the runtime data directory.
- Do not flatten everything into a single `ai.md`; use the directory split above so the responsibilities stay stable as the system grows.

## File Structure

- `app/` - Main desktop application
- `app/src/` - Frontend source code
- `app/src-tauri/` - Rust backend
- `web-chat/` - Web-based chat application
