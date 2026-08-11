import { describe, expect, it, vi } from 'vitest'

import { ReconcileConversationCrypto } from '../app/application/conversation-crypto/reconcile-conversation-crypto'
import type { ClientIdGenerator } from '../app/application/ports/client-id-generator'
import type {
  ConversationCryptoGateway,
  ConversationCryptoGeneration,
  FinalizeConversationCryptoCommand,
} from '../app/application/ports/conversation-crypto-gateway'
import type {
  ConversationCryptoLocalState,
  ConversationCryptoStateRepository,
} from '../app/application/ports/conversation-crypto-state-repository'
import type {
  DeviceCryptoGateway,
  DeviceCryptoIdentity,
  DeviceCryptoIdentityCommand,
  PublicKeyPackageValidationCommand,
  PublicKeyPackageValidationResult,
} from '../app/application/ports/device-crypto-gateway'
import type {
  BootstrapMlsConversationCommand,
  BootstrapMlsConversationResult,
  ApplyMlsCommitCommand,
  JoinMlsConversationCommand,
  MlsConversationGateway,
  MlsConversationStateResult,
  ProtectMlsMessageCommand,
  ProtectMlsMessageResult,
  UnprotectMlsMessageCommand,
  UnprotectMlsMessageResult,
  UpdateMlsConversationCommand,
  UpdateMlsConversationResult,
} from '../app/application/ports/mls-conversation-gateway'

const conversationId = '1b0a32e8-144f-4f60-bcb6-112f71bd5316'
const generationId = '50d6b08a-84ae-4bd7-829a-f40f38e9a2c1'
const coordinatorDeviceId = 'dd7c15b7-f8d2-402d-9abc-07ba98b79bfd'
const coordinatorUserId = '318887ee-2517-45fc-9635-07cf915b31b4'
const memberDeviceId = 'f34b0d48-6dc9-4ed1-9c5b-eb76544ead0a'
const memberUserId = 'd8f16ee6-7063-494e-a71b-558392476527'
const requestId = 'b24a030d-a3f0-4eed-a463-a1722920615c'
const retryRequestId = '6ae637c7-b4bc-4979-b032-00b8b9cbe155'
const secondGenerationId = 'e109d71c-8e4f-43fa-aafd-7ef7d16b2475'
const newDeviceId = '3ce72df7-3921-4c03-8ba8-4f1c0370bca9'
const fourthGenerationId = 'd7e13aed-0bf8-47cf-bcf4-4ff25b96d7e8'

class MemoryState implements ConversationCryptoStateRepository {
  value: ConversationCryptoLocalState | null = null
  readonly saveCalls: ConversationCryptoLocalState[] = []

  async load(): Promise<ConversationCryptoLocalState | null> {
    return this.value
  }

  async save(state: ConversationCryptoLocalState): Promise<void> {
    this.value = state
    this.saveCalls.push(state)
  }

  close(): void {}
}

class FixedIds implements ClientIdGenerator {
  constructor(private readonly values: string[]) {}

  create(): string {
    const value = this.values.shift()
    if (!value) throw new Error('unexpected id request')
    return value
  }
}

class FakeDeviceCrypto implements DeviceCryptoGateway {
  readonly validateKeyPackage = vi.fn(async (
    _command: PublicKeyPackageValidationCommand,
  ): Promise<PublicKeyPackageValidationResult> => ({ validated: true }))

  provision(_command: DeviceCryptoIdentityCommand): Promise<DeviceCryptoIdentity> {
    throw new Error('not used')
  }

  restore(_command: DeviceCryptoIdentityCommand): Promise<DeviceCryptoIdentity> {
    throw new Error('not used')
  }

  checkpoint(): Promise<DeviceCryptoIdentity> {
    throw new Error('not used')
  }

  dispose(): Promise<void> {
    return Promise.resolve()
  }
}

class FakeMls implements MlsConversationGateway {
  readonly bootstrapConversation = vi.fn(async (
    _command: BootstrapMlsConversationCommand,
  ): Promise<BootstrapMlsConversationResult> => ({
    commit: new Uint8Array([1]),
    welcome: new Uint8Array([2]),
    ratchetTree: new Uint8Array([3]),
    epoch: 2,
    revision: 2,
  }))

  readonly joinConversation = vi.fn(async (
    _command: JoinMlsConversationCommand,
  ): Promise<MlsConversationStateResult> => ({ epoch: 2, revision: 2 }))

  readonly rejoinConversation = vi.fn(async (
    _command: JoinMlsConversationCommand,
  ): Promise<MlsConversationStateResult> => ({ epoch: 5, revision: 5 }))

  readonly updateConversation = vi.fn(async (
    _command: UpdateMlsConversationCommand,
  ): Promise<UpdateMlsConversationResult> => ({
    commit: new Uint8Array([9]),
    welcome: new Uint8Array([10]),
    ratchetTree: new Uint8Array([11]),
    epoch: 3,
    revision: 3,
  }))

  readonly applyCommit = vi.fn(async (
    _command: ApplyMlsCommitCommand,
  ): Promise<MlsConversationStateResult> => ({ epoch: 3, revision: 3 }))

  protectMessage(_command: ProtectMlsMessageCommand): Promise<ProtectMlsMessageResult> {
    throw new Error('not used')
  }

  unprotectMessage(_command: UnprotectMlsMessageCommand): Promise<UnprotectMlsMessageResult> {
    throw new Error('not used')
  }
}

class CoordinatorServer implements ConversationCryptoGateway {
  finalizeAttempts = 0
  failFirstFinalize = true

  async getCurrent(): Promise<ConversationCryptoGeneration> {
    return generation('pending', coordinatorDeviceId)
  }

  async begin(): Promise<ConversationCryptoGeneration> {
    return generation('pending', coordinatorDeviceId)
  }

  async listReadyAfter(): Promise<readonly ConversationCryptoGeneration[]> {
    return []
  }

  async finalize(_command: FinalizeConversationCryptoCommand): Promise<ConversationCryptoGeneration> {
    this.finalizeAttempts += 1
    if (this.failFirstFinalize && this.finalizeAttempts === 1) throw new Error('network lost')
    return generation('ready', coordinatorDeviceId)
  }

  acknowledgeWelcome(): Promise<void> {
    throw new Error('not used')
  }
}

class MemberServer implements ConversationCryptoGateway {
  acknowledgeAttempts = 0
  failFirstAcknowledge = true

  async getCurrent(): Promise<ConversationCryptoGeneration> {
    return generation('ready', coordinatorDeviceId, memberDeviceId)
  }

  async begin(): Promise<ConversationCryptoGeneration> {
    return generation('ready', coordinatorDeviceId, memberDeviceId)
  }

  async listReadyAfter(
    _conversationId: string,
    afterGenerationNumber: number,
  ): Promise<readonly ConversationCryptoGeneration[]> {
    return afterGenerationNumber < 1
      ? [generation('ready', coordinatorDeviceId, memberDeviceId)]
      : []
  }

  finalize(): Promise<ConversationCryptoGeneration> {
    throw new Error('not used')
  }

  async acknowledgeWelcome(): Promise<void> {
    this.acknowledgeAttempts += 1
    if (this.failFirstAcknowledge && this.acknowledgeAttempts === 1) {
      throw new Error('network lost')
    }
  }
}

describe('conversation crypto reconciliation', () => {
  it('retries server finalization from the durable checkpoint without mutating MLS twice', async () => {
    const server = new CoordinatorServer()
    const state = new MemoryState()
    const deviceCrypto = new FakeDeviceCrypto()
    const mls = new FakeMls()
    const useCase = new ReconcileConversationCrypto(
      server,
      state,
      deviceCrypto,
      mls,
      new FixedIds([requestId]),
    )

    await expect(useCase.execute({ conversationId, deviceId: coordinatorDeviceId }))
      .rejects.toThrow('network lost')
    expect(state.value?.phase).toBe('coordinator-checkpointed')
    expect(mls.bootstrapConversation).toHaveBeenCalledTimes(1)
    expect(deviceCrypto.validateKeyPackage).toHaveBeenCalledTimes(1)

    await expect(useCase.execute({ conversationId, deviceId: coordinatorDeviceId }))
      .resolves.toMatchObject({ status: 'ready', epoch: 2 })
    expect(mls.bootstrapConversation).toHaveBeenCalledTimes(1)
    expect(server.finalizeAttempts).toBe(2)
    expect(state.value?.phase).toBe('ready')
  })

  it('checkpoints a joined member before acknowledgement and never joins twice', async () => {
    const server = new MemberServer()
    const state = new MemoryState()
    const mls = new FakeMls()
    const useCase = new ReconcileConversationCrypto(
      server,
      state,
      new FakeDeviceCrypto(),
      mls,
      new FixedIds([requestId]),
    )

    await expect(useCase.execute({ conversationId, deviceId: memberDeviceId }))
      .rejects.toThrow('network lost')
    expect(state.value?.phase).toBe('joined')
    expect(mls.joinConversation).toHaveBeenCalledTimes(1)

    await expect(useCase.execute({ conversationId, deviceId: memberDeviceId }))
      .resolves.toMatchObject({ status: 'ready', epoch: 2 })
    expect(mls.joinConversation).toHaveBeenCalledTimes(1)
    expect(server.acknowledgeAttempts).toBe(2)
    expect(state.value?.phase).toBe('ready')
  })

  it('persists one bootstrap request id before asking the server', async () => {
    const state = new MemoryState()
    const pending = generation('pending', coordinatorDeviceId)
    const server: ConversationCryptoGateway = {
      getCurrent: vi.fn(async () => null),
      listReadyAfter: vi.fn(async () => []),
      begin: vi.fn(async () => pending),
      finalize: vi.fn(async () => generation('ready', coordinatorDeviceId)),
      acknowledgeWelcome: vi.fn(async () => undefined),
    }
    const useCase = new ReconcileConversationCrypto(
      server,
      state,
      new FakeDeviceCrypto(),
      new FakeMls(),
      new FixedIds([requestId]),
    )

    await expect(useCase.execute({ conversationId, deviceId: coordinatorDeviceId }))
      .resolves.toMatchObject({ status: 'ready' })
    expect(server.begin).toHaveBeenCalledWith(conversationId, requestId)
    expect(state.saveCalls[0]).toMatchObject({
      bootstrapRequestId: requestId,
      phase: 'bootstrap-requested',
      generationId: null,
    })
  })

  it('uses a fresh operation after a terminal blocked bootstrap can be retried', async () => {
    const state = new MemoryState()
    const blocked: ConversationCryptoGeneration = {
      ...generation('pending', coordinatorDeviceId),
      status: 'blocked',
      blockReason: 'missing_identity',
    }
    const begin = vi.fn()
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(generation('pending', coordinatorDeviceId))
    const server: ConversationCryptoGateway = {
      getCurrent: vi.fn(async () => null),
      listReadyAfter: vi.fn(async () => []),
      begin,
      finalize: vi.fn(async () => generation('ready', coordinatorDeviceId)),
      acknowledgeWelcome: vi.fn(async () => undefined),
    }
    const useCase = new ReconcileConversationCrypto(
      server,
      state,
      new FakeDeviceCrypto(),
      new FakeMls(),
      new FixedIds([requestId, retryRequestId]),
    )

    await expect(useCase.execute({ conversationId, deviceId: coordinatorDeviceId }))
      .resolves.toMatchObject({ status: 'blocked', blockReason: 'missing_identity' })
    expect(state.value).toMatchObject({
      phase: 'bootstrap-requested',
      bootstrapRequestId: retryRequestId,
    })

    await expect(useCase.execute({ conversationId, deviceId: coordinatorDeviceId }))
      .resolves.toMatchObject({ status: 'ready' })
    expect(begin).toHaveBeenNthCalledWith(1, conversationId, requestId)
    expect(begin).toHaveBeenNthCalledWith(2, conversationId, retryRequestId)
  })

  it('creates one incremental Commit and routes Welcome only to a new device', async () => {
    const state = new MemoryState()
    state.value = readyLocalState(coordinatorDeviceId)
    const pending = incrementalGeneration('pending')
    const finalize = vi.fn(async () => incrementalGeneration('ready'))
    const server: ConversationCryptoGateway = {
      getCurrent: vi.fn(),
      listReadyAfter: vi.fn(async () => []),
      begin: vi.fn(async () => pending),
      finalize,
      acknowledgeWelcome: vi.fn(),
    }
    const mls = new FakeMls()
    const useCase = new ReconcileConversationCrypto(
      server,
      state,
      new FakeDeviceCrypto(),
      mls,
      new FixedIds([requestId]),
    )

    await expect(useCase.execute({ conversationId, deviceId: coordinatorDeviceId }))
      .resolves.toMatchObject({ status: 'ready', generationNumber: 2, epoch: 3 })
    expect(mls.updateConversation).toHaveBeenCalledWith({
      conversationId,
      desiredDeviceIds: [coordinatorDeviceId, memberDeviceId, newDeviceId],
      keyPackages: [new Uint8Array([12])],
    })
    expect(mls.bootstrapConversation).not.toHaveBeenCalled()
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({
      welcomes: [{ targetDeviceId: newDeviceId, welcome: new Uint8Array([10]) }],
    }))
    expect(state.value?.phase).toBe('ready')
  })

  it('updates from the latest ready MLS state across an intermediate blocked generation', async () => {
    const state = new MemoryState()
    state.value = readyLocalState(coordinatorDeviceId)
    const pending = { ...incrementalGeneration('pending'), generationNumber: 3 }
    const ready = { ...incrementalGeneration('ready'), generationNumber: 3 }
    const server: ConversationCryptoGateway = {
      getCurrent: vi.fn(),
      listReadyAfter: vi.fn(async () => []),
      begin: vi.fn(async () => pending),
      finalize: vi.fn(async () => ready),
      acknowledgeWelcome: vi.fn(),
    }
    const mls = new FakeMls()
    const useCase = new ReconcileConversationCrypto(
      server,
      state,
      new FakeDeviceCrypto(),
      mls,
      new FixedIds([requestId]),
    )

    await expect(useCase.execute({ conversationId, deviceId: coordinatorDeviceId }))
      .resolves.toMatchObject({ status: 'ready', generationNumber: 3 })
    expect(mls.updateConversation).toHaveBeenCalledOnce()
    expect(mls.bootstrapConversation).not.toHaveBeenCalled()
  })

  it('applies a ready membership Commit to an existing device without a Welcome', async () => {
    const state = new MemoryState()
    state.value = readyLocalState(memberDeviceId)
    const ready = incrementalGeneration('ready')
    const server: ConversationCryptoGateway = {
      getCurrent: vi.fn(),
      listReadyAfter: vi.fn(async () => [ready]),
      begin: vi.fn(async () => ready),
      finalize: vi.fn(),
      acknowledgeWelcome: vi.fn(),
    }
    const mls = new FakeMls()
    const useCase = new ReconcileConversationCrypto(
      server,
      state,
      new FakeDeviceCrypto(),
      mls,
      new FixedIds([requestId]),
    )

    await expect(useCase.execute({ conversationId, deviceId: memberDeviceId }))
      .resolves.toMatchObject({ status: 'ready', generationNumber: 2, epoch: 3 })
    expect(mls.applyCommit).toHaveBeenCalledWith({
      conversationId,
      commit: new Uint8Array([9]),
      desiredDeviceIds: [coordinatorDeviceId, memberDeviceId, newDeviceId],
    })
    expect(mls.joinConversation).not.toHaveBeenCalled()
    expect(state.saveCalls.map(item => item.phase)).toEqual(['commit-applied', 'ready'])
  })

  it('applies the next ready Commit even when blocked generations created a number gap', async () => {
    const state = new MemoryState()
    state.value = readyLocalState(memberDeviceId)
    const ready = { ...incrementalGeneration('ready'), generationNumber: 3 }
    const server: ConversationCryptoGateway = {
      getCurrent: vi.fn(),
      listReadyAfter: vi.fn(async () => [ready]),
      begin: vi.fn(async () => ready),
      finalize: vi.fn(),
      acknowledgeWelcome: vi.fn(),
    }
    const mls = new FakeMls()
    const useCase = new ReconcileConversationCrypto(
      server,
      state,
      new FakeDeviceCrypto(),
      mls,
      new FixedIds([requestId]),
    )

    await expect(useCase.execute({ conversationId, deviceId: memberDeviceId }))
      .resolves.toMatchObject({ status: 'ready', generationNumber: 3 })
    expect(mls.applyCommit).toHaveBeenCalledOnce()
    expect(mls.joinConversation).not.toHaveBeenCalled()
  })

  it('applies ordered missed commits and safely rejoins after a removal gap', async () => {
    const state = new MemoryState()
    state.value = readyLocalState(memberDeviceId)
    const second = incrementalGeneration('ready')
    const fourth = readdedGeneration()
    const server: ConversationCryptoGateway = {
      getCurrent: vi.fn(async () => fourth),
      begin: vi.fn(async () => fourth),
      listReadyAfter: vi.fn(async (_conversation, after) => (
        after < 2 ? [second, fourth] : after < 4 ? [fourth] : []
      )),
      finalize: vi.fn(),
      acknowledgeWelcome: vi.fn(async () => undefined),
    }
    const mls = new FakeMls()
    const useCase = new ReconcileConversationCrypto(
      server,
      state,
      new FakeDeviceCrypto(),
      mls,
      new FixedIds([requestId]),
    )

    await expect(useCase.execute({ conversationId, deviceId: memberDeviceId }))
      .resolves.toMatchObject({ status: 'ready', generationNumber: 4, epoch: 5 })
    expect(mls.applyCommit).toHaveBeenCalledOnce()
    expect(mls.rejoinConversation).toHaveBeenCalledWith({
      conversationId,
      welcome: new Uint8Array([42]),
      ratchetTree: new Uint8Array([43]),
    })
    expect(mls.joinConversation).not.toHaveBeenCalled()
    expect(server.acknowledgeWelcome).toHaveBeenCalledWith(conversationId, fourthGenerationId)
    expect(state.value).toMatchObject({ phase: 'ready', generationNumber: 4, epoch: 5 })
  })

  it('skips generations before this device enrollment and joins its first Welcome', async () => {
    const state = new MemoryState()
    const initial = generation('ready', coordinatorDeviceId)
    const beforeEnrollment: ConversationCryptoGeneration = {
      ...initial,
      requiredDevices: [initial.requiredDevices[0]!],
    }
    const enrolled = readdedGeneration()
    const server: ConversationCryptoGateway = {
      getCurrent: vi.fn(async () => enrolled),
      begin: vi.fn(async () => enrolled),
      listReadyAfter: vi.fn(async () => [beforeEnrollment, enrolled]),
      finalize: vi.fn(),
      acknowledgeWelcome: vi.fn(async () => undefined),
    }
    const mls = new FakeMls()
    mls.joinConversation.mockResolvedValue({ epoch: 5, revision: 5 })
    const useCase = new ReconcileConversationCrypto(
      server,
      state,
      new FakeDeviceCrypto(),
      mls,
      new FixedIds([requestId]),
    )

    await expect(useCase.execute({ conversationId, deviceId: memberDeviceId }))
      .resolves.toMatchObject({ status: 'ready', generationNumber: 4, epoch: 5 })
    expect(mls.applyCommit).not.toHaveBeenCalled()
    expect(mls.joinConversation).toHaveBeenCalledWith({
      conversationId,
      welcome: new Uint8Array([42]),
      ratchetTree: new Uint8Array([43]),
    })
    expect(server.acknowledgeWelcome).toHaveBeenCalledWith(conversationId, fourthGenerationId)
  })
})

function readyLocalState(ownerDeviceId: string): ConversationCryptoLocalState {
  return {
    ownerDeviceId,
    conversationId,
    bootstrapRequestId: 'ee4a35f8-23dc-45fa-933b-25ce50b7cf16',
    generationId,
    generationNumber: 1,
    phase: 'ready',
    epoch: 2,
    commit: null,
    ratchetTree: null,
    welcome: null,
    targetDeviceIds: [],
    updatedAt: '2026-08-11T12:01:00Z',
  }
}

function incrementalGeneration(status: 'pending' | 'ready'): ConversationCryptoGeneration {
  const base = generation(status, coordinatorDeviceId)
  return {
    ...base,
    generationId: secondGenerationId,
    generationNumber: 2,
    epoch: status === 'ready' ? 3 : null,
    commit: status === 'ready' ? new Uint8Array([9]) : null,
    ratchetTree: status === 'ready' ? new Uint8Array([11]) : null,
    requiredDevices: [
      base.requiredDevices[0]!,
      { ...base.requiredDevices[1]!, keyPackageRef: null, keyPackage: null },
      {
        userId: memberUserId,
        deviceId: newDeviceId,
        isCoordinator: false,
        fingerprint: '12'.repeat(32),
        credentialIdentity: new Uint8Array(33),
        signaturePublicKey: new Uint8Array(32),
        keyPackageRef: '34'.repeat(32),
        keyPackage: new Uint8Array([12]),
      },
    ],
  }
}

function readdedGeneration(): ConversationCryptoGeneration {
  const base = generation('ready', coordinatorDeviceId, memberDeviceId)
  return {
    ...base,
    generationId: fourthGenerationId,
    generationNumber: 4,
    epoch: 5,
    commit: new Uint8Array([41]),
    ratchetTree: new Uint8Array([43]),
    welcome: {
      targetDeviceId: memberDeviceId,
      welcome: new Uint8Array([42]),
      createdAt: '2026-08-11T12:04:00Z',
      expiresAt: '2026-08-12T12:04:00Z',
      acknowledgedAt: null,
    },
  }
}

function generation(
  status: 'pending' | 'ready',
  coordinator: string,
  welcomeFor: string | null = null,
): ConversationCryptoGeneration {
  return {
    generationId,
    conversationId,
    generationNumber: 1,
    protocolVersion: 2,
    status,
    blockReason: null,
    coordinatorDeviceId: coordinator,
    epoch: status === 'ready' ? 2 : null,
    commit: status === 'ready' ? new Uint8Array([1]) : null,
    ratchetTree: status === 'ready' ? new Uint8Array([3]) : null,
    createdAt: '2026-08-11T12:00:00Z',
    updatedAt: '2026-08-11T12:01:00Z',
    readyAt: status === 'ready' ? '2026-08-11T12:01:00Z' : null,
    requiredDevices: [
      {
        userId: coordinatorUserId,
        deviceId: coordinatorDeviceId,
        isCoordinator: true,
        fingerprint: 'ab'.repeat(32),
        credentialIdentity: new Uint8Array(33),
        signaturePublicKey: new Uint8Array(32),
        keyPackageRef: null,
        keyPackage: null,
      },
      {
        userId: memberUserId,
        deviceId: memberDeviceId,
        isCoordinator: false,
        fingerprint: 'cd'.repeat(32),
        credentialIdentity: new Uint8Array(33),
        signaturePublicKey: new Uint8Array(32),
        keyPackageRef: 'ef'.repeat(32),
        keyPackage: new Uint8Array([7, 8]),
      },
    ],
    welcome: welcomeFor === null ? null : {
      targetDeviceId: welcomeFor,
      welcome: new Uint8Array([2]),
      createdAt: '2026-08-11T12:01:00Z',
      expiresAt: '2026-08-12T12:01:00Z',
      acknowledgedAt: null,
    },
  }
}
