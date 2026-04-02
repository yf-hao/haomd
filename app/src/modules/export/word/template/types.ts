import type { WordBlock } from '../types'

export type TemplateContentSource =
  | {
      kind: 'frontMatter'
      key?: string
    }
  | {
      kind: 'heading'
      match?: string
      matchAny?: string[]
      includeHeading?: boolean
      headingBold?: boolean
      headingFontSizePt?: number | null
      childHeadingBold?: boolean
    }

export type WordTemplateBinding = {
  field: string
  placeholder: string
  type: 'text' | 'richText'
  source?: TemplateContentSource
}

export type WordTemplateConfig = {
  templateId: string
  name?: string | null
  bindings: WordTemplateBinding[]
}

export type TemplateContentModel = {
  meta: Record<string, string>
  sections: Record<string, string>
}

export type ParsedTemplateMarkdown = {
  frontMatter: Record<string, string>
  body: string
  model: TemplateContentModel
  richBlocksByField: Record<string, WordBlock[]>
}
