import { extractFrontMatter } from './frontMatter'
import { normalizeLatexDelimiters } from './normalizeLatexDelimiters'
import { replaceTextColorSyntaxWithHtml } from './extensions/colorMark'

export type PreviewMarkdownResult = {
  processedMarkdown: string
  hasMath: boolean
}

export function preparePreviewMarkdown(value: string): PreviewMarkdownResult {
  const bodyMarkdown = extractFrontMatter(value).body
  const processedMarkdown = replaceTextColorSyntaxWithHtml(normalizeLatexDelimiters(bodyMarkdown))
  return {
    processedMarkdown,
    hasMath: /\$/.test(processedMarkdown),
  }
}
