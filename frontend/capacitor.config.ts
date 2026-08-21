import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'ru.yoowee.chat',
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
