export interface ClipboardPort {
  writeText(value: string): Promise<void>
}
