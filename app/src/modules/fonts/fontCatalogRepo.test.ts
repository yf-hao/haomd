import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listSystemFonts } from './fontCatalogRepo'
import { mockInvoke } from '../../../vitest.setup'

describe('fontCatalogRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return system fonts from backend', async () => {
    vi.mocked(mockInvoke).mockResolvedValue({
      Ok: {
        data: [
          { family: 'Calibri', displayName: 'Calibri', source: 'system' },
          { family: 'Arial', displayName: 'Arial', source: 'system' },
        ],
      },
    })

    await expect(listSystemFonts()).resolves.toEqual([
      { family: 'Calibri', displayName: 'Calibri', source: 'system' },
      { family: 'Arial', displayName: 'Arial', source: 'system' },
    ])
    expect(mockInvoke).toHaveBeenCalledWith('list_system_fonts')
  })

  it('should throw when backend returns an error', async () => {
    vi.mocked(mockInvoke).mockResolvedValue({
      Err: { error: { code: 'UNKNOWN', message: 'font error' } },
    })

    await expect(listSystemFonts()).rejects.toThrow('font error')
  })
})

