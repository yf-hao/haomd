import { describe, expect, it } from 'vitest'
import { htmlToMarkdown } from './htmlToMarkdown'

describe('htmlToMarkdown', () => {
  it('converts common article HTML into Markdown while dropping inline styles', () => {
    expect(htmlToMarkdown(`
      <article style="color:red">
        <h1>标题</h1>
        <p>正文 <strong>加粗</strong> 和 <a href="https://example.com">链接</a>。</p>
        <ul><li>第一项</li><li>第二项</li></ul>
        <pre><code class="language-ts">const answer = 42</code></pre>
        <img src="images/article_1.png" alt="示意图">
      </article>
    `)).toBe([
      '# 标题',
      '正文 **加粗** 和 [链接](https://example.com)。',
      '- 第一项\n- 第二项',
      '```ts\nconst answer = 42\n```',
      '![示意图](images/article_1.png)',
    ].join('\n\n'))
  })

  it('converts tables and preserves remote image URLs for later localization', () => {
    expect(htmlToMarkdown(`
      <table>
        <tr><th>名称</th><th>值</th></tr>
        <tr><td>A</td><td>1</td></tr>
      </table>
      <p><img src="https://example.com/image.png"></p>
    `)).toBe([
      '| 名称 | 值 |',
      '| --- | --- |',
      '| A | 1 |',
      '',
      '![图片](https://example.com/image.png)',
    ].join('\n'))
  })
})
