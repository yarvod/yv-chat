import type { DeviceInfo, DeviceInfoPort } from '../../application/ports/device-info'

interface UserAgentDataLike {
  readonly mobile?: boolean
  readonly platform?: string
}

type NavigatorWithUserAgentData = Navigator & {
  readonly userAgentData?: UserAgentDataLike
}

function browserName(userAgent: string): string {
  if (/Edg\//u.test(userAgent)) return 'Edge'
  if (/OPR\//u.test(userAgent)) return 'Opera'
  if (/CriOS|Chrome\//u.test(userAgent)) return 'Chrome'
  if (/FxiOS|Firefox\//u.test(userAgent)) return 'Firefox'
  if (/Safari\//u.test(userAgent)) return 'Safari'
  return 'Браузер'
}

function operatingSystem(userAgent: string, platform?: string): string {
  const source = `${platform ?? ''} ${userAgent}`
  if (/iPhone|iPad|iPod/u.test(source)) return 'iOS'
  if (/Android/u.test(source)) return 'Android'
  if (/Windows/u.test(source)) return 'Windows'
  if (/Macintosh|macOS|MacIntel/u.test(source)) return 'macOS'
  if (/Linux/u.test(source)) return 'Linux'
  return 'Неизвестная ОС'
}

function deviceClass(userAgent: string, mobile?: boolean): DeviceInfo['deviceClass'] {
  if (/iPad|Tablet/u.test(userAgent)) return 'tablet'
  if (mobile === true || /iPhone|Android.*Mobile/u.test(userAgent)) return 'mobile'
  if (/Android/u.test(userAgent)) return 'tablet'
  return 'desktop'
}

export class BrowserDeviceInfo implements DeviceInfoPort {
  constructor(private readonly navigatorRef: NavigatorWithUserAgentData = navigator) {}

  current(): DeviceInfo {
    const userAgent = this.navigatorRef.userAgent
    const browser = browserName(userAgent)
    const operatingSystemName = operatingSystem(userAgent, this.navigatorRef.userAgentData?.platform)
    const currentDeviceClass = deviceClass(userAgent, this.navigatorRef.userAgentData?.mobile)
    const classLabel = currentDeviceClass === 'mobile'
      ? 'Телефон'
      : currentDeviceClass === 'tablet' ? 'Планшет' : 'Компьютер'
    return {
      label: `${browser} · ${operatingSystemName} · ${classLabel}`.slice(0, 80),
      browser,
      operatingSystem: operatingSystemName,
      deviceClass: currentDeviceClass,
    }
  }
}
