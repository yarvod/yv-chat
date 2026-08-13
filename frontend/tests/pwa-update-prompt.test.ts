import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AppUpdatePrompt from '../app/components/ui/AppUpdatePrompt.vue'

describe('PWA update prompt', () => {
  it('requires an explicit enabled click before activation', async () => {
    const wrapper = mount(AppUpdatePrompt, { props: { busy: false, failed: false } })

    expect(wrapper.text()).toContain('Доступна новая версия')
    expect(wrapper.text()).toContain('только после вашего нажатия')
    expect(wrapper.emitted('activate')).toBeUndefined()

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('activate')).toHaveLength(1)
  })

  it('blocks duplicate activation while the update is being applied', async () => {
    const wrapper = mount(AppUpdatePrompt, { props: { busy: true, failed: false } })
    const button = wrapper.get('button')

    expect(button.attributes('disabled')).toBeDefined()
    expect(button.text()).toContain('Обновляем')
    await button.trigger('click')
    expect(wrapper.emitted('activate')).toBeUndefined()
  })

  it('keeps the running version usable after an activation failure', () => {
    const wrapper = mount(AppUpdatePrompt, { props: { busy: false, failed: true } })

    expect(wrapper.text()).toContain('Текущая версия продолжает работать')
    expect(wrapper.get('button').text()).toBe('Повторить')
  })
})
