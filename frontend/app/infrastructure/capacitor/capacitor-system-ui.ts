import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import { StatusBar, Style } from '@capacitor/status-bar'

import type { ResolvedTheme } from '../../domain/preferences/theme'
import { SYSTEM_BAR_COLORS } from '../browser/theme-preferences'

export class CapacitorSystemUi {
  async applyTheme(theme: ResolvedTheme): Promise<void> {
    await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light })
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: SYSTEM_BAR_COLORS[theme] })
    }
  }

  async subscribeKeyboard(root: HTMLElement): Promise<() => void> {
    const showing = await Keyboard.addListener('keyboardWillShow', () => {
      root.classList.add('app-keyboard-active')
    })
    const hiding = await Keyboard.addListener('keyboardWillHide', () => {
      root.classList.remove('app-keyboard-active')
    })
    return () => {
      void showing.remove()
      void hiding.remove()
      root.classList.remove('app-keyboard-active')
    }
  }
}
