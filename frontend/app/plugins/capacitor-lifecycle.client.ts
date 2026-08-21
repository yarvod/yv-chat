import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

import { nativeNavigationTarget } from '../presentation/chat/conversation-route'

export default defineNuxtPlugin(nuxtApp => {
  if (!Capacitor.isNativePlatform()) return

  const open = (url: string): void => {
    const target = nativeNavigationTarget(url)
    if (!target) return
    void navigateTo({
      path: '/chat',
      query: {
        conversation: target.conversationId,
        ...(target.messageId ? { message: target.messageId } : {}),
      },
    })
  }

  const listeners = Promise.all([
    App.addListener('appUrlOpen', event => open(event.url)),
    App.addListener('appStateChange', state => {
      if (state.isActive) window.dispatchEvent(new Event('yv-native-resume'))
    }),
  ])
  void App.getLaunchUrl().then(result => {
    if (result?.url) open(result.url)
  }).catch(() => undefined)

  nuxtApp.vueApp.onUnmount(() => {
    void listeners.then(handles => Promise.all(handles.map(handle => handle.remove())))
  })
})
