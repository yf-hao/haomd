import type { GlobalMemoryDialogInitialTab } from '../ui/GlobalMemoryDialog'

export type GlobalMemoryUiBridge = {
  openGlobalMemoryDialog?: (options: { initialTab: GlobalMemoryDialogInitialTab }) => void
}
