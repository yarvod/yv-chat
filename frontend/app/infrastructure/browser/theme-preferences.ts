import type { ThemePreferencesPort } from '../../application/ports/theme-preferences'
import { isThemePreference, type ResolvedTheme, type ThemePreference } from '../../domain/preferences/theme'

const STORAGE_KEY = 'yv-chat:theme'

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
    this.documentRef.getElementById('yv-theme-color')?.setAttribute(
      'content',
      resolved === 'dark' ? '#0a0b10' : '#f4f2fb',
    )
    return resolved
  }

  subscribeSystemChange(listener: () => void): () => void {
    this.media.addEventListener('change', listener)
    return () => this.media.removeEventListener('change', listener)
  }
}
