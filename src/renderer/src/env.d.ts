import type { CiBoardApi } from '@shared/ipc'

declare global {
  interface Window {
    ciboard: CiBoardApi
  }
}
