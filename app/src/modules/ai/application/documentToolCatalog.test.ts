import { describe, expect, it } from 'vitest'
import { buildDocumentToolCatalogPrompt } from './documentToolCatalog'

describe('documentToolCatalog', () => {
  it('includes explicit examples for fileName and workspace directory mapping', () => {
    const prompt = buildDocumentToolCatalogPrompt()

    expect(prompt).toContain('保存为 demo.md')
    expect(prompt).toContain('target=workspace_directory')
    expect(prompt).toContain('离散数学/教案')
    expect(prompt).toContain('fileName')
    expect(prompt).toContain('create_directory_under_selection')
    expect(prompt).toContain('创建 demo 目录')
  })

  it('does not advertise pdf as a supported AI export format', () => {
    const prompt = buildDocumentToolCatalogPrompt()

    expect(prompt).not.toContain('format=pdf')
    expect(prompt).not.toContain('支持 md、word、html；pdf')
  })
})
