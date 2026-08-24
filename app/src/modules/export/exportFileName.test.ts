import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXPORT_BASE_NAME,
  extractFirstMarkdownHeading,
  resolveExportBaseName,
} from './exportFileName'

describe('export file name helpers', () => {
  it('prefers the current file name', () => {
    expect(resolveExportBaseName('notes.md', '# Document title')).toBe('notes')
  })

  it('uses the first level-one heading for unsaved documents', () => {
    expect(resolveExportBaseName(null, '---\ntitle: Metadata\n---\n\n# Project plan')).toBe('Project plan')
  })

  it('ignores headings inside fenced code blocks', () => {
    expect(extractFirstMarkdownHeading('```md\n# Not a heading\n```\n\n# Actual title')).toBe('Actual title')
  })

  it('falls back to the untitled document name', () => {
    expect(resolveExportBaseName(null, 'No heading here')).toBe(DEFAULT_EXPORT_BASE_NAME)
  })

  it('sanitizes characters that cannot be used in file names', () => {
    expect(resolveExportBaseName(null, '# A/B: C?')).toBe('A-B- C-')
  })
})
