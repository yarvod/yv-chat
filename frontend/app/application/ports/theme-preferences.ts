import type { ResolvedTheme, ThemePreference } from '../../domain/preferences/theme'

export interface ThemePreferencesPort {
  load(): ThemePreference
  apply(preference: ThemePreference): ResolvedTheme
  subscribeSystemChange(listener: () => void): () => void
}
