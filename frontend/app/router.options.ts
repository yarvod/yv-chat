import type { RouterConfig } from '@nuxt/schema'

export default <RouterConfig>{
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    // Activation/reset credentials live after # so they never reach HTTP, but
    // must also never be treated as selectors or echoed by router warnings.
    if (to.hash.startsWith('#token=')) return { left: 0, top: 0 }
    if (to.hash) return { el: to.hash, behavior: 'smooth' }
    return { left: 0, top: 0 }
  },
}
