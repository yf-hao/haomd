import { getFilePathIdentity } from './filePathState'

export class FileOpenCoordinator {
  private readonly inFlight = new Map<string, Promise<unknown>>()

  run<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const key = getFilePathIdentity(path)
    const pending = this.inFlight.get(key)
    if (pending) return pending as Promise<T>

    const task = Promise.resolve().then(operation)
    this.inFlight.set(key, task)

    const release = () => {
      if (this.inFlight.get(key) === task) {
        this.inFlight.delete(key)
      }
    }
    void task.then(release, release)
    return task
  }
}
