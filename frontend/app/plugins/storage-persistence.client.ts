import { BrowserStoragePersistence } from '../infrastructure/browser/storage-persistence'

export default defineNuxtPlugin({
  name: 'yv-chat:storage-persistence',
  setup(): void {
    void new BrowserStoragePersistence().request()
  },
})
