export interface ExternalLinks {
  needsActionMenu(): boolean
  externalUrl(href: string): string | null
  canShare(): boolean
  share(url: string): Promise<void>
}
