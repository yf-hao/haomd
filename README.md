# HaoMD

English | [中文](README_CN.md)

A high-performance, cross-platform Markdown editor built with Tauri 2 + React + TypeScript. Features real-time preview, AI assistant integration, visualizations, multi-tab editing, and offline-first experience.

---

## Features

### Core Editor
- 🚀 **High-Performance**: Smooth editing for large files (>10MB) with CodeMirror 6
- 📑 **Multi-Tab**: Edit multiple documents simultaneously
- 👁️ **Real-Time Preview**: Split-view editor with live Markdown rendering
- 💾 **Auto-Save**: Intelligent auto-save with conflict detection
- 🔍 **Outline Navigation**: Auto-generated document outline for quick navigation

### AI Assistant
- 🤖 **Multi-Provider Support**: Dify, OpenAI-compatible APIs
- 📄 **Document Chat**: AI assistant for document analysis and Q&A
- 🔄 **Directory-based Session Management**: Maintain independent AI conversation contexts per directory
- ✂️ **Selection Chat**: Ask questions about selected text
- 🖼️ **Vision Understanding**: Analyze images with AI
- 🧠 **Global Memory**: AI remembers context across conversations
- 📝 **System Prompts**: Customizable system prompts for different use cases
- 🗜️ **Conversation Compression**: Smart compression to manage long conversations

### Visualizations
- 📐 **KaTeX**: Beautiful mathematical formulas
- 📊 **Mermaid**: Flowcharts, sequence diagrams, Gantt charts, and more
- 🧠 **Mind Maps**: Interactive mind map diagrams

### File Management
- 📁 **File Browser**: Built-in file explorer with folder navigation
- 🕒 **Recent Files**: Quick access to recently opened files
- 🔗 **PDF Reader**: Built-in PDF viewing and navigation
- 🖨️ **Export**: Export to PDF (via system print) and HTML

### Media Support
- 🎵 **Audio**: Play MP3, WAV, M4A, OGG, FLAC files directly in Markdown
- 🎬 **Video**: Play MP4, WebM, MOV, OGG files with poster image support
- 📷 **Images**: Support for various image formats with custom sizing

### UI/UX
- 🎨 **Dark Theme**: Eye-friendly dark mode
- 📱 **Responsive Design**: Adapts to different window sizes
- ⌨️ **Keyboard Shortcuts**: Full keyboard shortcut support

---

## Development Environment

- Node.js 18+
- npm or bun
- Rust stable (for Tauri)
- macOS / Windows / Linux

---

## Quick Start

### Install Dependencies

```bash
cd app
npm install
# or
bun install
```

### Development Mode

```bash
npm run tauri:dev
# or
bun run tauri:dev
```

This will start the Tauri development server, automatically compiling both frontend and Rust backend.

### Production Build

```bash
npm run tauri build
# or
bun run tauri build
```

Build artifacts are located in the `app/src-tauri/target/release/bundle/` directory.

---

## Project Structure

```
markdown/
├── app/                    # Frontend app (React + Vite)
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── modules/        # Feature modules (AI, files, export, etc.)
│   │   ├── hooks/          # Custom hooks
│   │   ├── config/         # Configuration files
│   │   └── types/          # TypeScript type definitions
│   ├── public/             # Static assets
│   └── src-tauri/          # Rust backend (Tauri)
├── web-chat/               # Web version
└── package.json
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, TypeScript, Vite |
| **Desktop** | Tauri 2 (Rust) |
| **Editor** | CodeMirror 6 |
| **Markdown** | ReactMarkdown, remark/rehype plugins |
| **Math** | KaTeX |
| **Diagrams** | Mermaid, Mind Elixir |
| **AI** | OpenAI SDK, Custom APIs (Dify, Vision-capable providers) |

---

## AI Configuration

HaoMD supports multiple AI providers, configurable within the app:

### Supported Providers

- **Dify**: Custom AI workflows and agent building platform (default)
- **OpenAI-compatible**: Any API compatible with OpenAI's format (GPT-4, GPT-3.5, o1, etc.)
- **Vision Support**: Any AI provider with vision capabilities for image analysis

### AI Features

- **Document Chat**: Chat with your documents to analyze content, ask questions, get summaries
- **Selection Chat**: Highlight text and ask AI questions about specific sections
- **Vision Upload**: Upload images for AI to analyze and describe
- **Global Memory**: AI maintains context across multiple conversations
- **Conversation History**: Access and review past AI conversations

> **Note**: Using AI features requires configuring the corresponding API Key in Settings > AI Settings.

---

## Keyboard Shortcuts

| Command | macOS | Windows/Linux |
|---------|-------|---------------|
| New File | `Cmd+N` | `Ctrl+N` |
| Open File | `Cmd+O` | `Ctrl+O` |
| Open Folder | `Cmd+Shift+O` | `Ctrl+Shift+O` |
| Save | `Cmd+S` | `Ctrl+S` |
| Save As | `Cmd+Shift+S` | `Ctrl+Shift+S` |
| Close File | `Cmd+W` | `Ctrl+W` |
| Toggle Preview | `Cmd+P` | `Ctrl+P` |
| Toggle Sidebar | `Cmd+B` | `Ctrl+B` |
| AI Chat | `Cmd+Shift+C` | `Ctrl+Shift+C` |
| Ask AI About File | `Cmd+Shift+A` | `Ctrl+Shift+A` |
| Ask AI About Selection | `Cmd+Shift+S` | `Ctrl+Shift+S` |
| Go to Line | `Cmd+L` | `Ctrl+L` |
| Find | `Cmd+F` | `Ctrl+F` |
| Replace | `Cmd+H` | `Ctrl+H` |
| Format Document | `Cmd+Shift+F` | `Ctrl+Shift+F` |
| Toggle Comment | `Cmd+/` | `Ctrl+/` |
| Stop AI Generation | `Cmd+Z` (while AI is generating) | `Ctrl+Z` (while AI is generating) |

---

## Media Support

HaoMD supports embedding and playing media files directly in Markdown:

### Audio

```markdown
![audio](./music.mp3)
```

**Supported formats**: MP3, WAV, M4A, OGG, FLAC

### Video

```markdown
![video](./video/demo.mp4)
![video|cover.png](./video/demo.mp4)  # With poster image
```

**Supported formats**: MP4, WebM, MOV, OGG

### Images

```markdown
![Image](./image.png)
![Image(50%)](./image.png)  # 50% width
![Image(400px)](./image.png)  # Fixed width
```

**Supported formats**: PNG, JPG, JPEG, GIF, SVG, WEBP

---

## Markdown Features

### Supported Syntax

- **Headers**: `#` through `######`
- **Emphasis**: `*italic*`, `**bold**`, `~~strikethrough~~`
- **Lists**: Ordered and unordered lists
- **Links**: `[text](url)`
- **Images**: `
![alt](url)
`
- **Code**: Inline `` `code` `` and code blocks with syntax highlighting
- **Blockquotes**: `> quote`
- **Tables**: Standard Markdown tables
- **Task Lists**: `- [ ]` and `- [x]`
- **Math**: KaTeX formulas `$inline$` and `$$block$$`
- **Diagrams**: Mermaid with ```mermaid code block
- **Mind Maps**: Mind diagrams with ```mind code block

### GFM Extensions

- **Strikethrough**: `~~text~~`
- **Tables**: `| Header | Header |`
- **Task Lists**: `- [ ] Task`
- **Autolinks**: URLs automatically converted to links

---

## Export

### PDF Export

Export to PDF using the system print dialog with optimized formatting:

```typescript
// PDF export includes:
- Styled HTML with CSS
- Rendered Mermaid diagrams
- Mind map visualizations
- KaTeX formulas
- Syntax-highlighted code blocks
```

### HTML Export

Export to clean, self-contained HTML with embedded styles.

---

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Development Guidelines

- Follow the existing code style and conventions
- Add tests for new features
- Update documentation as needed
- Ensure TypeScript compilation passes

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Roadmap

- [ ] Collaborative Editing
- [ ] Cloud Sync
- [ ] Plugin System
- [ ] Word Export
- [ ] More Diagram Types (PlantUML, Graphviz)
- [ ] Custom Themes
- [ ] Mobile Support

---

## About

HaoMD is a high-performance Markdown editor focused on writing and document editing. It combines modern web technologies with native desktop performance through Tauri, providing a smooth and responsive editing experience.

For questions, suggestions, or issues, please feel free to open an issue on GitHub.

---

## Acknowledgments

- [Tauri](https://tauri.app/) - Desktop app framework
- [React](https://reactjs.org/) - UI library
- [CodeMirror](https://codemirror.net/) - Text editor component
- [KaTeX](https://katex.org/) - Math rendering
- [Mermaid](https://mermaid-js.github.io/) - Diagram rendering
- [Mind Elixir](https://github.com/awehook/remark-mindmap) - Mind map rendering

