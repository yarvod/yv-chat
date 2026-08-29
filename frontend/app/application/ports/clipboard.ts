export interface ClipboardPort {
  writeText(value: string): Promise<void>
  writeImage(value: Blob | Promise<Blob>): Promise<void>
}
