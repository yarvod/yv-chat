import { PwaUpdateCoordinator } from '../application/pwa/pwa-update-coordinator'
import { BrowserPageVisibility } from '../infrastructure/browser/page-visibility'
import { BrowserScheduler } from '../infrastructure/browser/scheduler'
import { VitePwaUpdateGateway } from '../infrastructure/pwa/vite-pwa-update-gateway'

export default defineNuxtPlugin({
  name: 'yv-chat:pwa-lifecycle',
  dependsOn: ['vite-pwa:nuxt:client:plugin'],
  setup(nuxtApp): void {
    const coordinator = new PwaUpdateCoordinator(
      new VitePwaUpdateGateway(nuxtApp.$pwa),
      new BrowserPageVisibility(),
      new BrowserScheduler(),
    )
    coordinator.start()
  },
})
