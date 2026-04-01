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
      headingFontSizePt?: number
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
  meta: {
    week_range: string
    date_range: string
    chapter_title: string
    teaching_type: string
    teaching_hours: string
  }
  sections: {
    teaching_objectives: string
    teaching_requirements: string
    teaching_focus: string
    teaching_difficulties: string
    student_notes: string
    teaching_methods: string
    discussion_exercises_homework: string
    content_outline: string
    teaching_postscript: string
  }
}

export type ParsedTemplateMarkdown = {
  frontMatter: Record<string, string>
  body: string
  model: TemplateContentModel
  richBlocksByField: Record<string, WordBlock[]>
}
