import type { ThemePreferencesPort } from '../../application/ports/theme-preferences'
import { isThemePreference, type ResolvedTheme, type ThemePreference } from '../../domain/preferences/theme'

const STORAGE_KEY = 'yv-chat:theme'
export const SYSTEM_BAR_COLORS = { dark: '#151721', light: '#ffffff' } as const

export function applySystemBarColor(documentRef: Document, resolved: ResolvedTheme): void {
  for (const meta of documentRef.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    if (meta.content !== SYSTEM_BAR_COLORS[resolved]) meta.content = SYSTEM_BAR_COLORS[resolved]
  }
}

export class BrowserThemePreferences implements ThemePreferencesPort {
  constructor(
    private readonly documentRef: Document = document,
    private readonly storage: Storage = localStorage,
    private readonly media = matchMedia('(prefers-color-scheme: dark)'),
  ) {}

  load(): ThemePreference {
    const stored = this.storage.getItem(STORAGE_KEY)
    return isThemePreference(stored) ? stored : 'system'
  }

  apply(preference: ThemePreference): ResolvedTheme {
    const resolved = preference === 'system' ? (this.media.matches ? 'dark' : 'light') : preference
    this.storage.setItem(STORAGE_KEY, preference)
    this.documentRef.documentElement.dataset.theme = resolved
    this.documentRef.documentElement.style.colorScheme = resolved
    applySystemBarColor(this.documentRef, resolved)
    return resolved
  }

  subscribeSystemChange(listener: () => void): () => void {
    this.media.addEventListener('change', listener)
    return () => this.media.removeEventListener('change', listener)
  }
}
