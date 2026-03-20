import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FontSelectField } from './FontSelectField'
import * as fontCatalogService from '../../modules/fonts/fontCatalogService'

describe('FontSelectField', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should load fonts and allow selecting a system font', async () => {
    const onChange = vi.fn()
    vi.spyOn(fontCatalogService, 'loadAvailableFonts').mockResolvedValue([
      { family: 'Calibri', displayName: 'Calibri', source: 'builtin' },
      { family: 'Source Han Sans SC', displayName: 'Source Han Sans SC', source: 'system' },
    ])

    render(<FontSelectField value="Times New Roman" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /times new roman/i }))

    await waitFor(() => {
      expect(screen.getByText('Source Han Sans SC')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /source han sans sc/i }))
    expect(onChange).toHaveBeenCalledWith('Source Han Sans SC')
  })

  it('should filter fonts by search keyword', async () => {
    vi.spyOn(fontCatalogService, 'loadAvailableFonts').mockResolvedValue([
      { family: 'Calibri', displayName: 'Calibri', source: 'builtin' },
      { family: 'Source Han Sans SC', displayName: 'Source Han Sans SC', source: 'system' },
    ])

    render(<FontSelectField value="Calibri" onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /^calibri$/i }))

    await waitFor(() => {
      expect(screen.getByText('Source Han Sans SC')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('Search fonts'), {
      target: { value: 'source han' },
    })

    expect(screen.queryByRole('button', { name: /^calibri builtin$/i })).not.toBeInTheDocument()
    expect(screen.getByText('Source Han Sans SC')).toBeInTheDocument()
  })

  it('should support keyboard selection from search input', async () => {
    const onChange = vi.fn()
    vi.spyOn(fontCatalogService, 'loadAvailableFonts').mockResolvedValue([
      { family: 'Calibri', displayName: 'Calibri', source: 'builtin' },
      { family: 'Source Han Sans SC', displayName: 'Source Han Sans SC', source: 'system' },
    ])

    render(<FontSelectField value="Times New Roman" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /times new roman/i }))

    const searchInput = await screen.findByPlaceholderText('Search fonts')
    await waitFor(() => {
      expect(screen.getByText('Source Han Sans SC')).toBeInTheDocument()
    })
    fireEvent.keyDown(searchInput, { key: 'ArrowDown' })
    fireEvent.keyDown(searchInput, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('Source Han Sans SC')
  })
})
