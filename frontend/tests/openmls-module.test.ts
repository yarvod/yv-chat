import { describe, expect, it, vi } from 'vitest'

import {
  loadOpenMlsModule,
  type OpenMlsModule,
} from '../app/infrastructure/crypto/openmls-module'

function moduleFixture(initialize: () => Promise<unknown>): OpenMlsModule {
  const Bootstrap = Object.assign(
    function BootstrapFixture() { return undefined },
    { restoreSealedState(): Promise<never> {
      return Promise.reject(new Error('not used'))
    } },
  )
  Object.assign(Bootstrap.prototype, {
    createConversation: vi.fn(),
    addMembersAndMerge: vi.fn(),
    joinConversation: vi.fn(),
    protectApplicationMessage: vi.fn(),
    unprotectApplicationMessage: vi.fn(),
  })
  return {
    default: initialize,
    DeviceBootstrap: Bootstrap as unknown as OpenMlsModule['DeviceBootstrap'],
    validatePublicKeyPackage: vi.fn(),
  }
}

describe('versioned OpenMLS module loader', () => {
  it('separates import, binding shape and WASM initialization failures', async () => {
    await expect(loadOpenMlsModule(async () => {
      throw new Error('private import error')
    })).rejects.toMatchObject({ code: 'runtime-import-failed' })

    await expect(loadOpenMlsModule(async () => ({ default: vi.fn() })))
      .rejects.toMatchObject({ code: 'runtime-invalid-module' })

    await expect(loadOpenMlsModule(async () => moduleFixture(async () => {
      throw new Error('private init error')
    }))).rejects.toMatchObject({ code: 'runtime-init-failed' })
  })

  it('returns only a fully initialized expected binding', async () => {
    const initialize = vi.fn(async () => undefined)
    const expected = moduleFixture(initialize)
    await expect(loadOpenMlsModule(async () => expected)).resolves.toBe(expected)
    expect(initialize).toHaveBeenCalledOnce()
  })
})
