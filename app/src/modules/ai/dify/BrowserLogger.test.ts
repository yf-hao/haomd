import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BrowserLogger } from './BrowserLogger'

describe('BrowserLogger', () => {
  const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
  const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('debug should log with or without context', () => {
    const logger = new BrowserLogger()
    logger.debug('msg1')
    logger.debug('msg2', { a: 1 })

    expect(debugSpy).toHaveBeenCalledWith('[DEBUG] msg1')
    expect(debugSpy).toHaveBeenCalledWith('[DEBUG] msg2', { a: 1 })
  })

  it('info should log with or without context', () => {
    const logger = new BrowserLogger()
    logger.info('msg1')
    logger.info('msg2', { a: 1 })

    expect(infoSpy).toHaveBeenCalledWith('[INFO] msg1')
    expect(infoSpy).toHaveBeenCalledWith('[INFO] msg2', { a: 1 })
  })

  it('warn should log with or without context', () => {
    const logger = new BrowserLogger()
    logger.warn('msg1')
    logger.warn('msg2', { a: 1 })

    expect(warnSpy).toHaveBeenCalledWith('[WARN] msg1')
    expect(warnSpy).toHaveBeenCalledWith('[WARN] msg2', { a: 1 })
  })

  it('error should log with or without context', () => {
    const logger = new BrowserLogger()
    logger.error('msg1')
    logger.error('msg2', { a: 1 })

    expect(errorSpy).toHaveBeenCalledWith('[ERROR] msg1')
    expect(errorSpy).toHaveBeenCalledWith('[ERROR] msg2', { a: 1 })
  })
})
