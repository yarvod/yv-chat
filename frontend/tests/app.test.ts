import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import App from '../app/app.vue'

describe('app shell', () => {
  it('identifies the application', () => {
    const wrapper = mount(App)

    expect(wrapper.get('h1').text()).toBe('yv-chat')
  })
})

