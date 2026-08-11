import { computed, onBeforeUnmount, onMounted } from 'vue'

import type { ServerConnectionState } from '../../application/connectivity/connection-monitor'

export function useConnectionStatus() {
  const { $frontend } = useNuxtApp()
  const state = useState<ServerConnectionState>('server-connection', () => 'checking')
  const monitor = $frontend.createConnectionMonitor()

  onMounted(() => monitor.start(next => {
    state.value = next
  }))
  onBeforeUnmount(() => monitor.stop())

  return { state: computed(() => state.value) }
}
