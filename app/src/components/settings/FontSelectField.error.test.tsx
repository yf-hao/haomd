import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FontSelectField } from './FontSelectField'
import * as fontCatalogService from '../../modules/fonts/fontCatalogService'

describe('FontSelectField fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should show an error when system font loading fails', async () => {
    vi.spyOn(fontCatalogService, 'loadAvailableFonts').mockRejectedValue(new Error('font error'))

    render(<FontSelectField value="Times New Roman" onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /times new roman/i }))

    await waitFor(() => {
      expect(screen.getByText('font error')).toBeTruthy()
    })
    expect(screen.getByText('No fonts matched your search.')).toBeTruthy()
  })
})
