import { describe, expect, it, vi } from 'vitest'
import { FileOpenCoordinator } from './fileOpenCoordinator'

describe('FileOpenCoordinator', () => {
  it('shares one operation for concurrent equivalent Windows paths', async () => {
    const coordinator = new FileOpenCoordinator()
    let resolveOpen!: (value: string) => void
    const operation = vi.fn(() => new Promise<string>((resolve) => {
      resolveOpen = resolve
    }))

    const first = coordinator.run('C:\\Docs\\Test.md', operation)
    const second = coordinator.run('c:/docs/test.md', operation)
    await Promise.resolve()
    resolveOpen('opened')

    await expect(Promise.all([first, second])).resolves.toEqual(['opened', 'opened'])
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('releases the path after a failed operation', async () => {
    const coordinator = new FileOpenCoordinator()
    const failure = new Error('failed')

    await expect(coordinator.run('/tmp/test.md', async () => {
      throw failure
    })).rejects.toBe(failure)

    await expect(coordinator.run('/tmp/test.md', async () => 'retried')).resolves.toBe('retried')
  })
})
