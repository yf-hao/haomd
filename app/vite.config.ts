import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const chunksMap: Record<string, string[]> = {
  'vendor-codemirror': [
    '@codemirror/view',
    '@codemirror/state',
    '@codemirror/language',
    '@codemirror/commands',
    '@codemirror/search',
    '@codemirror/autocomplete',
    '@codemirror/lint',
    '@uiw/react-codemirror',
  ],
  'vendor-markdown': [
    'react-markdown',
    'remark-gfm',
    'remark-math',
    'rehype-raw',
    'rehype-sanitize',
    'rehype-katex',
  ],
  'vendor-diagram': ['mermaid', 'mind-elixir'],
  'vendor-pdf': ['pdfjs-dist'],
  'vendor-syntax': ['react-syntax-highlighter'],
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          for (const [chunk, packages] of Object.entries(chunksMap)) {
            if (packages.some((pkg) => id.includes(`node_modules/${pkg}/`) || id.includes(`node_modules/${pkg}/`))) {
              return chunk
            }
          }
        },
      },
    },
  },
})
