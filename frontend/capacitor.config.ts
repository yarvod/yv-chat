import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'de.com.yoowee.chat',
  appName: 'yv-chat',
  webDir: '.output/public',
  loggingBehavior: 'none',
  server: {
    hostname: 'app.yvchat.local',
  },
  plugins: {
    CapacitorCookies: { enabled: true },
    CapacitorHttp: { enabled: true },
    Keyboard: { resize: 'native', resizeOnFullScreen: true },
    // Foreground delivery is rendered by the active app/WebSocket just like the PWA.
    PushNotifications: { presentationOptions: [] },
    StatusBar: { overlaysWebView: true },
  },
  ios: {
    preferredContentMode: 'mobile',
    webContentsDebuggingEnabled: false,
  },
  android: {
    adjustMarginsForEdgeToEdge: 'auto',
    webContentsDebuggingEnabled: false,
  },
}

export default config
