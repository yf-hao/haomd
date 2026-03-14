export interface TemplateOptions {
  title: string
  body: string
  hasMind: boolean
  hasMermaid: boolean
}

const KATEX_CDN = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css'
// 使用 UMD 格式，兼容性最好，避免 ES Module 跨域问题
const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js'
// highlight.js CSS 主题（github 风格，与应用浅色主题一致）
const HLJS_CSS_CDN = 'https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github.min.css'

export function generateHTMLTemplate(options: TemplateOptions): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${options.title}</title>
  <link rel="stylesheet" href="${KATEX_CDN}">
  <link rel="stylesheet" href="${HLJS_CSS_CDN}">
  ${options.hasMermaid ? `<script src="${MERMAID_CDN}" defer></script>
  <script>
    (function() {
      const initMermaid = function() {
        if (typeof mermaid !== 'undefined') {
          mermaid.initialize({ startOnLoad: true, theme: 'default' });
        }
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMermaid);
      } else {
        initMermaid();
      }
    })();
  </script>` : ''}
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans CN', 'Segoe UI', Helvetica, Arial, sans-serif; padding: 20px; color: #1a1a1a; }
    .markdown-body { max-width: 800px; margin: 0 auto; line-height: 1.7; }
    /* 导出 HTML 中的 TOC 列表缩进 */
    .markdown-body .md-toc-item {
      list-style: none;
      margin: 2px 0;
    }
    .markdown-body .md-toc-level-1 {
      font-weight: 600;
    }
    .markdown-body .md-toc-level-2 {
      padding-left: 16px;
    }
    .markdown-body .md-toc-level-3 {
      padding-left: 32px;
      font-size: 0.95em;
    }
    .markdown-body em {
      font-style: italic;
      display: inline-block;
      transform: skewX(-8deg);
      font-family: "Noto Serif SC", "Songti SC", "STSong", "Source Han Serif SC",
                   system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    img { max-width: 100%; height: auto; }
    pre { background-color: #f6f8fa; padding: 16px; border-radius: 6px; overflow: auto; }
    pre.mermaid { background-color: transparent; padding: 0; }
    code { font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace; font-size: 0.9em; }
    .katex-display { overflow-x: auto; overflow-y: hidden; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #dfe2e5; padding: 6px 13px; }
    th { background-color: #f6f8fa; }
    blockquote { border-left: 4px solid #dfe2e5; margin: 0; padding-left: 16px; color: #6a737d; }
    @media print {
      body {
        padding: 0;
        font-family: 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans CN', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif !important;
      }
      .markdown-body { max-width: none; }
      .page-break { page-break-before: always; }
    }
  </style>
</head>
<body>
  ${options.body}
</body>
</html>`
}
