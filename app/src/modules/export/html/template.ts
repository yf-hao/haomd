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
  <script>
    (function() {
      function toggleTocSections(expand) {
        var sections = document.querySelectorAll('.md-toc-root details');
        sections.forEach(function(section) {
          if (expand) {
            section.setAttribute('open', 'open');
          } else {
            section.removeAttribute('open');
          }
        });
      }

      function initTocToggle() {
        var summary = document.querySelector('.md-toc-summary');
        if (!summary) return;

        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'md-toc-toggle-all';

        var expanded = false;

        function renderIcon() {
          if (expanded) {
            // 减号图标：当前为展开状态，可点击折叠
            button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.2"></circle><line x1="4" y1="8" x2="12" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"></line></svg>';
            button.setAttribute('aria-label', '折叠三级标题');
          } else {
            // 加号图标：当前为折叠状态，可点击展开
            button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.2"></circle><line x1="4" y1="8" x2="12" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"></line><line x1="8" y1="4" x2="8" y2="12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"></line></svg>';
            button.setAttribute('aria-label', '展开三级标题');
          }
        }

        button.addEventListener('click', function(event) {
          // 阻止触发外层 summary 的默认折叠行为，只控制三级目录
          event.stopPropagation();
          event.preventDefault();

          expanded = !expanded;
          toggleTocSections(expanded);
          renderIcon();
        });

        renderIcon();
        summary.appendChild(button);
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTocToggle);
      } else {
        initTocToggle();
      }
    })();
  </script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans CN', 'Segoe UI', Helvetica, Arial, sans-serif; padding: 20px; color: #1a1a1a; }
    .markdown-body {
      max-width: 800px;
      margin: 0 auto;
      line-height: 1.7;
    }
    /* 导出 HTML 中的 TOC 浮动目录容器与列表缩进（靠正文而非窗边） */
    .markdown-body .md-toc-container {
      position: fixed;
      top: 40px;
      /* 以正文居中线为基准，向左偏移：400(半宽) + 24(间距) + 220(目录宽) */
      left: calc(50% - 400px - 60px - 220px);
      width: 220px;
      max-height: calc(100vh - 120px);
      overflow-y: auto;
      padding: 8px 12px;
      border: 1px solid #e4e4e4;
      border-radius: 4px;
      background-color: #fafafa;
      font-size: 0.9em;
      z-index: 100;
    }
    .markdown-body .md-toc-summary {
      cursor: pointer;
      font-weight: 600;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .markdown-body .md-toc-toggle-all {
      border: none;
      background: transparent;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      color: #666;
      cursor: pointer;
    }
    .markdown-body .md-toc-toggle-all:hover {
      color: #111;
    }
    .markdown-body .md-toc-toggle-all svg {
      width: 16px;
      height: 16px;
      display: block;
    }
    .markdown-body .md-toc-root {
      margin: 0;
      padding-left: 0;
    }
    .markdown-body .md-toc-root ul {
      margin: 0;
      padding-left: 0;
    }
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
    @media (max-width: 1100px) {
      .markdown-body {
        max-width: 800px;
      }
      .markdown-body .md-toc-container {
        position: static;
        left: auto;
        width: auto;
        max-height: none;
        margin-bottom: 12px;
      }
    }
    @media print {
      body {
        padding: 0;
        font-family: 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans CN', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif !important;
      }
      .markdown-body { max-width: none; }
      .page-break { page-break-before: always; }
      /* 打印/导出为 PDF 时隐藏目录 TOC */
      .markdown-body .md-toc-item {
        display: none !important;
      }
      .markdown-body .md-toc-container {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  ${options.body}
</body>
</html>`
}
