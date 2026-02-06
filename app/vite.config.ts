import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import strip from '@rollup/plugin-strip'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: {
    target: 'es2018',
    rollupOptions: {
      plugins: [
        mode === 'production'
          ? strip({
              include: ['src/**/*.[jt]s', 'src/**/*.[jt]sx'],
              functions: ['console.log', 'console.debug', 'console.info'],
              debugger: true,
            })
          : undefined,
      ].filter(Boolean),
      output: {
        manualChunks(id) {
          if (
            id.includes('@uiw/react-codemirror') ||
            id.includes('@codemirror/')
          ) {
            return 'editor'
          }

          if (
            id.includes('react-markdown') ||
            id.includes('remark-gfm') ||
            id.includes('remark-math') ||
            id.includes('rehype-katex') ||
            id.includes('rehype-highlight') ||
            id.includes('react-syntax-highlighter')
          ) {
            return 'markdown'
          }

          if (
            id.includes('mermaid') ||
            id.includes('mind-elixir') ||
            id.includes('cytoscape')
          ) {
            return 'diagrams'
          }

          if (id.includes('katex')) {
            return 'katex'
          }

          return undefined
        },
      },
    },
  },
}))
