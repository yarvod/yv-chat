import { describe, expect, it } from 'vitest'

import {
  deviceCryptoIssueMessage,
  deviceCryptoIssueNeedsReconnect,
} from '../app/presentation/composables/useDeviceCryptoLifecycle'

describe('device crypto lifecycle diagnostics', () => {
  it('requires a new device login when registered local keys are missing or invalid', () => {
    for (const issue of [
      'not-provisioned',
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
})
