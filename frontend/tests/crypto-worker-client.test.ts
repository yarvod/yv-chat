import { afterEach, describe, expect, it, vi } from 'vitest'

import { CryptoWorkerClient } from '../app/infrastructure/crypto/crypto-worker-client'
import { mlsRequestEnvelope } from '../app/infrastructure/crypto/mls-worker-protocol'
import {
  errorResponse,
  parseWorkerRequest,
  parseWorkerResponse,
  successResponse,
} from '../app/infrastructure/crypto/worker-protocol'

const userId = '1b0a32e8-144f-4f60-bcb6-112f71bd5316'
const deviceId = '50d6b08a-84ae-4bd7-829a-f40f38e9a2c1'
const firstRequestId = '11111111-1111-4111-8111-111111111111'
const secondRequestId = '22222222-2222-4222-8222-222222222222'
const thirdRequestId = '33333333-3333-4333-8333-333333333333'
const fourthRequestId = '44444444-4444-4444-8444-444444444444'
const conversationId = 'f6a5941b-c417-4e50-a69c-9a30bd7ed28c'
const messageId = '538998bb-1943-4cf3-beb1-8b87cadf0fc1'

const identity = {
  userId,
  deviceId,
  revision: 1,
  fingerprint: 'ab'.repeat(32),
  credentialIdentity: new Uint8Array(33),
  signaturePublicKey: new Uint8Array(32),
  keyPackage: new Uint8Array([1, 2, 3]),
}
const validationCommand = {
  targetUserId: userId,
  targetDeviceId: deviceId,
  credentialIdentity: identity.credentialIdentity,
  signaturePublicKey: identity.signaturePublicKey,
  fingerprint: identity.fingerprint,
  packageRef: 'cd'.repeat(32),
  keyPackage: identity.keyPackage,
}

class MockWorker extends EventTarget {
  readonly messages: unknown[] = []
  readonly terminate = vi.fn()

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  reply(message: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: message }))
  }
}

function requestIds(...ids: string[]): () => string {
  let index = 0
  return () => ids[index++] ?? firstRequestId
}

afterEach(() => {
  vi.useRealTimers()
})

describe('device crypto Worker protocol', () => {
  it('accepts only the closed versioned request and bounded public response schema', () => {
    expect(parseWorkerRequest({
      version: 2,
      requestId: firstRequestId,
      type: 'restore',
      command: { userId, deviceId },
    })).toMatchObject({ type: 'restore', command: { userId, deviceId } })
    expect(parseWorkerRequest({
      version: 1,
      requestId: firstRequestId,
      type: 'checkpoint',
    })).toBeNull()

    expect(parseWorkerRequest({
      version: 2,
      requestId: firstRequestId,
      type: 'validate-key-package',
      command: validationCommand,
    })).toMatchObject({ type: 'validate-key-package' })
    expect(parseWorkerResponse(successResponse(firstRequestId, { validated: true })))
      .toMatchObject({ ok: true, result: { validated: true } })
    expect(parseWorkerRequest({
      version: 2,
      requestId: firstRequestId,
      type: 'provision',
      command: { userId: 'not-a-uuid', deviceId },
    })).toBeNull()

    expect(parseWorkerResponse(successResponse(firstRequestId, identity)))
      .toMatchObject({ ok: true, result: { fingerprint: identity.fingerprint } })
    expect(parseWorkerResponse({
      version: 2,
      requestId: firstRequestId,
      ok: false,
      error: { code: 'raw exception with private state' },
    })).toBeNull()
    expect(parseWorkerResponse(successResponse(firstRequestId, {
      ...identity,
      credentialIdentity: new Uint8Array(32),
    }))).toBeNull()
    expect(parseWorkerResponse({
      ...successResponse(firstRequestId, identity),
      result: { ...identity, ciphertext: new Uint8Array(16) },
    })).toBeNull()
  })

  it('correlates responses, maps bounded errors and disposes the Worker', async () => {
    const worker = new MockWorker()
    const client = new CryptoWorkerClient(
      () => worker as unknown as Worker,
      1_000,
      requestIds(firstRequestId, secondRequestId),
    )

    const provisioning = client.provision({ userId, deviceId })
    const provisionRequest = parseWorkerRequest(worker.messages[0])
    expect(provisionRequest?.type).toBe('provision')
    worker.reply(successResponse(firstRequestId, identity))
    await expect(provisioning).resolves.toEqual(identity)

    const checkpoint = client.checkpoint()
    worker.reply(errorResponse(secondRequestId, 'rollback'))
    await expect(checkpoint).rejects.toMatchObject({ code: 'rollback' })

    const disposing = client.dispose()
    const disposeRequest = parseWorkerRequest(worker.messages[2])
    expect(disposeRequest?.type).toBe('dispose')
    if (!disposeRequest) throw new Error('expected dispose request')
    worker.reply(successResponse(disposeRequest.requestId, { disposed: true }))
    await disposing
    expect(worker.terminate).toHaveBeenCalledOnce()
    await expect(client.restore({ userId, deviceId })).rejects.toMatchObject({
      code: 'runtime-unavailable',
    })
  })

  it('routes public KeyPackage validation without returning key bytes', async () => {
    const worker = new MockWorker()
    const client = new CryptoWorkerClient(
      () => worker as unknown as Worker,
      1_000,
      requestIds(firstRequestId),
    )

    const validating = client.validateKeyPackage(validationCommand)
    expect(parseWorkerRequest(worker.messages[0])).toMatchObject({
      type: 'validate-key-package',
      command: validationCommand,
    })
    worker.reply(successResponse(firstRequestId, { validated: true }))
    await expect(validating).resolves.toEqual({ validated: true })
  })

  it('routes only bounded MLS commands and exact result variants', async () => {
    const worker = new MockWorker()
    const client = new CryptoWorkerClient(
      () => worker as unknown as Worker,
      1_000,
      requestIds(firstRequestId, secondRequestId, thirdRequestId, fourthRequestId),
    )
    const bootstrapResult = {
      commit: new Uint8Array([1]),
      welcome: new Uint8Array([2]),
      ratchetTree: new Uint8Array([3]),
      epoch: 1,
      revision: 2,
    }
    const bootstrapping = client.bootstrapConversation({
      conversationId,
      keyPackages: [identity.keyPackage],
    })
    expect(parseWorkerRequest(worker.messages[0])).toMatchObject({
      type: 'mls-bootstrap',
      command: { conversationId },
    })
    worker.reply(successResponse(firstRequestId, bootstrapResult))
    await expect(bootstrapping).resolves.toEqual(bootstrapResult)

    const joining = client.joinConversation({
      conversationId,
      welcome: bootstrapResult.welcome,
      ratchetTree: bootstrapResult.ratchetTree,
    })
    worker.reply(successResponse(secondRequestId, { epoch: 1, revision: 2 }))
    await expect(joining).resolves.toEqual({ epoch: 1, revision: 2 })

    const protecting = client.protectMessage({
      conversationId,
      clientMessageId: messageId,
      plaintext: new Uint8Array([4]),
    })
    const protectedResult = { ciphertext: new Uint8Array([5]), epoch: 1, revision: 3 }
    worker.reply(successResponse(thirdRequestId, protectedResult))
    await expect(protecting).resolves.toEqual(protectedResult)

    const unprotecting = client.unprotectMessage({
      conversationId,
      clientMessageId: messageId,
      ciphertext: protectedResult.ciphertext,
    })
    const unprotectedResult = { plaintext: new Uint8Array([4]), revision: 3 }
    worker.reply(successResponse(fourthRequestId, unprotectedResult))
    await expect(unprotecting).resolves.toEqual(unprotectedResult)

    expect(parseWorkerRequest({
      ...mlsRequestEnvelope(firstRequestId, 'mls-protect', {
        conversationId,
        clientMessageId: messageId,
        plaintext: new Uint8Array([1]),
      }),
      leakedPrivateState: new Uint8Array([9]),
    })).toBeNull()
    expect(parseWorkerResponse(successResponse(firstRequestId, {
      ...protectedResult,
      plaintext: new Uint8Array([9]),
    }))).toBeNull()
  })

  it('fails all pending calls on malformed messages and timeouts', async () => {
    vi.useFakeTimers()
    const worker = new MockWorker()
    const client = new CryptoWorkerClient(
      () => worker as unknown as Worker,
      10,
      requestIds(firstRequestId, secondRequestId),
    )
    const first = client.restore({ userId, deviceId })
    const second = client.checkpoint()
    worker.reply({ requestId: firstRequestId, ok: true, result: 'private-state' })
    await expect(first).rejects.toMatchObject({ code: 'worker-protocol' })
    await expect(second).rejects.toMatchObject({ code: 'worker-protocol' })

    const timedOut = client.checkpoint()
    const timeoutAssertion = expect(timedOut).rejects.toMatchObject({
      code: 'worker-timeout',
    })
    await vi.advanceTimersByTimeAsync(11)
    await timeoutAssertion
  })
})
