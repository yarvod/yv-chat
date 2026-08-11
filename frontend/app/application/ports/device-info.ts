export interface DeviceInfo {
  readonly label: string
  readonly browser: string
  readonly operatingSystem: string
  readonly deviceClass: 'mobile' | 'tablet' | 'desktop' | 'unknown'
}

export interface DeviceInfoPort {
  current(): DeviceInfo
}
