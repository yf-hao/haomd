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

## File Structure

- `app/` - Main desktop application
- `app/src/` - Frontend source code
- `app/src-tauri/` - Rust backend
- `web-chat/` - Web-based chat application