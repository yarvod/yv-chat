import { describe, expect, it, vi } from 'vitest'

import {
  deviceCryptoIssueMessage,
  deviceCryptoIssueNeedsReconnect,
  resumeHistorySyncAfterCryptoReady,
  synchronizeDeviceCryptoSession,
} from '../app/presentation/composables/useDeviceCryptoLifecycle'
import type { CurrentAccount } from '../app/domain/accounts/account'

const account: CurrentAccount = {
  userId: '11111111-1111-4111-8111-111111111111',
  deviceId: '22222222-2222-4222-8222-222222222222',
  username: 'alice',
  displayName: 'Alice',
  role: 'user',
  deviceDisplayName: 'Chrome · macOS · Компьютер',
}

describe('device crypto lifecycle diagnostics', () => {
  it('shares an already active device session instead of disposing it during page startup', async () => {
    const session = {
      initialize: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    }

    await synchronizeDeviceCryptoSession(session, account)

    expect(session.initialize).toHaveBeenCalledWith({
      userId: account.userId,
      deviceId: account.deviceId,
    })
    expect(session.dispose).not.toHaveBeenCalled()
  })

  it('disposes the device session only after the authenticated account disappears', async () => {
    const session = {
      initialize: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    }

    await synchronizeDeviceCryptoSession(session, null)

    expect(session.dispose).toHaveBeenCalledOnce()
    expect(session.initialize).not.toHaveBeenCalled()
  })

  it('requires a new device login when registered local keys are missing or invalid', () => {
    for (const issue of [
      'not-provisioned',
      'local-state-lost',
      'conflict',
      'corrupt-state',
      'rollback',
      'invalid-key-package',
    ] as const) {
      expect(deviceCryptoIssueNeedsReconnect(issue)).toBe(true)
      expect(deviceCryptoIssueMessage(issue)).toContain('устройств')
    }
  })

  it('keeps transient runtime, storage and network failures retryable', () => {
    for (const issue of [
      'runtime-unavailable',
      'runtime-import-failed',
      'runtime-init-failed',
      'runtime-invalid-module',
      'worker-failed',
      'worker-protocol',
      'worker-timeout',
      'storage-unavailable',
      'network',
    ] as const) {
      expect(deviceCryptoIssueNeedsReconnect(issue)).toBe(false)
      expect(deviceCryptoIssueMessage(issue).length).toBeGreaterThan(20)
    }
  })

  it('starts persisted history jobs even when foreground roster refresh fails', async () => {
    const start = vi.fn()
    const reconcileCurrentRoster = vi.fn().mockRejectedValue(new Error('network'))

    resumeHistorySyncAfterCryptoReady({
      deviceHistorySync: { start },
      linkedDeviceEnrollment: { reconcileCurrentRoster },
    }, account)
    await Promise.resolve()

    expect(start).toHaveBeenCalledWith(account.userId, account.deviceId)
    expect(reconcileCurrentRoster).toHaveBeenCalledWith(account.userId)
  })
})
