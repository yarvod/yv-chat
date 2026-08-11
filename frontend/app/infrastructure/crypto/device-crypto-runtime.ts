import { DeviceCryptoError } from '../../application/device-crypto/errors'
import type {
  DeviceCryptoIdentity,
  DeviceCryptoIdentityCommand,
  PublicKeyPackageValidationCommand,
  PublicKeyPackageValidationResult,
} from '../../application/ports/device-crypto-gateway'
import type {
  BootstrapMlsConversationCommand,
  BootstrapMlsConversationResult,
  JoinMlsConversationCommand,
  MlsConversationStateResult,
  ProtectMlsMessageCommand,
  ProtectMlsMessageResult,
  UnprotectMlsMessageCommand,
  UnprotectMlsMessageResult,
} from '../../application/ports/mls-conversation-gateway'
import {
  CryptoVaultError,
  type CryptoVault,
  type CryptoVaultReady,
  type SealedCryptoStateDraft,
} from './crypto-vault'
import type {
  OpenMlsDeviceBootstrap,
  OpenMlsModule,
  OpenMlsSealedSnapshot,
} from './openmls-module'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/
const CREDENTIAL_IDENTITY_BYTES = 33
const SIGNATURE_PUBLIC_KEY_BYTES = 32
const MAX_KEY_PACKAGE_BYTES = 1024 * 1024
const MAX_MLS_APPLICATION_BYTES = 256 * 1024
const MAX_MLS_WIRE_BYTES = 1024 * 1024
const MAX_MLS_ADD_MEMBERS = 49

interface ActiveBootstrap {
  userId: string
  deviceId: string
  revision: number
  value: OpenMlsDeviceBootstrap
}

function translateError(error: unknown): DeviceCryptoError {
  if (error instanceof DeviceCryptoError) return error
  if (error instanceof CryptoVaultError) {
    const mapping = {
      conflict: 'conflict',
      corrupt: 'corrupt-state',
      rollback: 'rollback',
      'storage-unavailable': 'storage-unavailable',
    } as const
    return new DeviceCryptoError(mapping[error.kind])
  }
  return new DeviceCryptoError('operation-failed')
}

function validCommand(command: DeviceCryptoIdentityCommand): boolean {
  return UUID_PATTERN.test(command.userId) && UUID_PATTERN.test(command.deviceId)
}

function sealedDraft(snapshot: OpenMlsSealedSnapshot): SealedCryptoStateDraft {
  const revision = Number(snapshot.revision)
  if (!Number.isSafeInteger(revision) || BigInt(revision) !== snapshot.revision) {
    throw new DeviceCryptoError('rollback')
  }
  return {
    revision,
    fingerprint: snapshot.fingerprint,
    iv: snapshot.iv.slice(),
    ciphertext: snapshot.ciphertext.slice(),
  }
}

export class DeviceCryptoRuntime {
  private active: ActiveBootstrap | null = null

  constructor(
    private readonly module: OpenMlsModule,
    private readonly vault: CryptoVault,
  ) {}

  async provision(command: DeviceCryptoIdentityCommand): Promise<DeviceCryptoIdentity> {
    this.assertCommand(command)
    const existing = this.existing(command)
    if (existing) return this.publicIdentity(existing)

    try {
      const loaded = await this.vault.load(command.userId, command.deviceId)
      if (loaded.status === 'ready') return await this.activate(command, loaded)

      const candidate = new this.module.DeviceBootstrap(command.userId, command.deviceId)
      try {
        const committed = await this.vault.bootstrap(
          command.userId,
          command.deviceId,
          key => this.seal(candidate, key, 1),
        )
        return await this.activate(command, committed)
      } finally {
        candidate.free()
      }
    } catch (error) {
      throw translateError(error)
    }
  }

  async restore(command: DeviceCryptoIdentityCommand): Promise<DeviceCryptoIdentity> {
    this.assertCommand(command)
    const existing = this.existing(command)
    if (existing) return this.publicIdentity(existing)

    try {
      const loaded = await this.vault.load(command.userId, command.deviceId)
      if (loaded.status === 'missing') throw new DeviceCryptoError('not-provisioned')
      return await this.activate(command, loaded)
    } catch (error) {
      throw translateError(error)
    }
  }

  async checkpoint(): Promise<DeviceCryptoIdentity> {
    const active = this.active
    if (!active) throw new DeviceCryptoError('not-provisioned')
    try {
      const stored = await this.vault.update(
        active.userId,
        active.deviceId,
        (key, revision) => this.seal(active.value, key, revision),
      )
      active.revision = stored.revision
      return this.publicIdentity(active)
    } catch (error) {
      throw translateError(error)
    }
  }

  async validateKeyPackage(
    command: PublicKeyPackageValidationCommand,
  ): Promise<PublicKeyPackageValidationResult> {
    if (
      !UUID_PATTERN.test(command.targetUserId)
      || !UUID_PATTERN.test(command.targetDeviceId)
      || command.credentialIdentity.byteLength !== CREDENTIAL_IDENTITY_BYTES
      || command.signaturePublicKey.byteLength !== SIGNATURE_PUBLIC_KEY_BYTES
      || !FINGERPRINT_PATTERN.test(command.fingerprint)
      || !FINGERPRINT_PATTERN.test(command.packageRef)
      || command.keyPackage.byteLength === 0
      || command.keyPackage.byteLength > MAX_KEY_PACKAGE_BYTES
    ) throw new DeviceCryptoError('invalid-request')
    try {
      this.module.validatePublicKeyPackage(
        command.targetUserId,
        command.targetDeviceId,
        command.credentialIdentity,
        command.signaturePublicKey,
        command.fingerprint,
        command.packageRef,
        command.keyPackage,
      )
      return { validated: true }
    } catch {
      throw new DeviceCryptoError('invalid-key-package')
    }
  }

  async bootstrapConversation(
    command: BootstrapMlsConversationCommand,
  ): Promise<BootstrapMlsConversationResult> {
    if (
      !UUID_PATTERN.test(command.conversationId)
      || command.keyPackages.length === 0
      || command.keyPackages.length > MAX_MLS_ADD_MEMBERS
      || command.keyPackages.some(item => (
        !(item instanceof Uint8Array)
        || item.byteLength === 0
        || item.byteLength > MAX_KEY_PACKAGE_BYTES
      ))
    ) throw new DeviceCryptoError('invalid-request')
    return await this.mutateAndCheckpoint(active => {
      active.createConversation(command.conversationId)
      const output = active.addMembersAndMerge(
        command.conversationId,
        command.keyPackages.map(item => item.slice()),
      )
      try {
        return {
          commit: output.commit.slice(),
          welcome: output.welcome.slice(),
          ratchetTree: output.ratchetTree.slice(),
          epoch: safeUnsignedInteger(output.epoch),
        }
      } finally {
        output.free()
      }
    })
  }

  async joinConversation(
    command: JoinMlsConversationCommand,
  ): Promise<MlsConversationStateResult> {
    if (
      !UUID_PATTERN.test(command.conversationId)
      || !validWireBytes(command.welcome)
      || !validWireBytes(command.ratchetTree)
    ) throw new DeviceCryptoError('invalid-request')
    return await this.mutateAndCheckpoint(active => ({
      epoch: safeUnsignedInteger(active.joinConversation(
        command.conversationId,
        command.welcome,
        command.ratchetTree,
      )),
    }))
  }

  async protectMessage(command: ProtectMlsMessageCommand): Promise<ProtectMlsMessageResult> {
    if (
      !validMessageRouting(command.conversationId, command.clientMessageId)
      || !(command.plaintext instanceof Uint8Array)
      || command.plaintext.byteLength === 0
      || command.plaintext.byteLength > MAX_MLS_APPLICATION_BYTES
    ) throw new DeviceCryptoError('invalid-request')
    return await this.mutateAndCheckpointWithMessageContent(command, active => {
      const output = active.protectApplicationMessage(
        command.conversationId,
        command.clientMessageId,
        command.plaintext,
      )
      try {
        return {
          ciphertext: output.ciphertext.slice(),
          epoch: safeUnsignedInteger(output.epoch),
        }
      } finally {
        output.free()
      }
    })
  }

  async unprotectMessage(
    command: UnprotectMlsMessageCommand,
  ): Promise<UnprotectMlsMessageResult> {
    if (
      !validMessageRouting(command.conversationId, command.clientMessageId)
      || !validWireBytes(command.ciphertext)
    ) throw new DeviceCryptoError('invalid-request')
    const active = this.active
    if (!active) throw new DeviceCryptoError('not-provisioned')
    try {
      const cached = await this.vault.loadMessageContent(
        active.userId,
        active.deviceId,
        command.conversationId,
        command.clientMessageId,
      )
      if (cached !== null) return { plaintext: cached, revision: active.revision }
    } catch (error) {
      throw translateError(error)
    }
    return await this.mutateAndCheckpointWithMessageContent(command, active => ({
      plaintext: active.unprotectApplicationMessage(
        command.conversationId,
        command.clientMessageId,
        command.ciphertext,
      ).slice(),
    }))
  }

  dispose(): void {
    this.active?.value.free()
    this.active = null
    this.vault.close()
  }

  private assertCommand(command: DeviceCryptoIdentityCommand): void {
    if (!validCommand(command)) throw new DeviceCryptoError('invalid-request')
  }

  private existing(command: DeviceCryptoIdentityCommand): ActiveBootstrap | null {
    if (!this.active) return null
    if (this.active.userId !== command.userId || this.active.deviceId !== command.deviceId) {
      throw new DeviceCryptoError('conflict')
    }
    return this.active
  }

  private async activate(
    command: DeviceCryptoIdentityCommand,
    ready: CryptoVaultReady,
  ): Promise<DeviceCryptoIdentity> {
    const restored = await this.module.DeviceBootstrap.restoreSealedState(
      ready.wrappingKey,
      command.userId,
      command.deviceId,
      ready.state.fingerprint,
      BigInt(ready.state.revision),
      ready.state.iv,
      ready.state.ciphertext,
    )
    const next: ActiveBootstrap = {
      ...command,
      revision: ready.state.revision,
      value: restored,
    }
    try {
      const result = this.publicIdentity(next)
      this.active?.value.free()
      this.active = next
      return result
    } catch (error) {
      restored.free()
      throw error
    }
  }

  private async seal(
    bootstrap: OpenMlsDeviceBootstrap,
    key: CryptoKey,
    revision: number,
  ): Promise<SealedCryptoStateDraft> {
    const snapshot = await bootstrap.sealState(key, BigInt(revision))
    try {
      return sealedDraft(snapshot)
    } finally {
      snapshot.free()
    }
  }

  private publicIdentity(active: ActiveBootstrap): DeviceCryptoIdentity {
    const fingerprint = active.value.fingerprint()
    const credentialIdentity = active.value.credentialIdentity()
    const signaturePublicKey = active.value.signaturePublicKey()
    const keyPackage = active.value.keyPackage()
    if (
      !FINGERPRINT_PATTERN.test(fingerprint)
      || credentialIdentity.byteLength !== CREDENTIAL_IDENTITY_BYTES
      || signaturePublicKey.byteLength !== SIGNATURE_PUBLIC_KEY_BYTES
      || keyPackage.byteLength === 0
      || keyPackage.byteLength > MAX_KEY_PACKAGE_BYTES
    ) {
      throw new DeviceCryptoError('corrupt-state')
    }
    return {
      userId: active.userId,
      deviceId: active.deviceId,
      revision: active.revision,
      fingerprint,
      credentialIdentity: credentialIdentity.slice(),
      signaturePublicKey: signaturePublicKey.slice(),
      keyPackage: keyPackage.slice(),
    }
  }

  private async mutateAndCheckpoint<T extends object>(
    operation: (active: OpenMlsDeviceBootstrap) => T,
  ): Promise<T & { revision: number }> {
    const active = this.active
    if (!active) throw new DeviceCryptoError('not-provisioned')
    try {
      const result = operation(active.value)
      const stored = await this.vault.update(
        active.userId,
        active.deviceId,
        (key, revision) => this.seal(active.value, key, revision),
      )
      active.revision = stored.revision
      return { ...result, revision: active.revision }
    } catch (error) {
      // A failed mutation/checkpoint must never keep a potentially advanced
      // sender/receiver ratchet alive against the previous durable snapshot.
      active.value.free()
      this.active = null
      throw translateError(error)
    }
  }

  private async mutateAndCheckpointWithMessageContent<
    T extends { plaintext: Uint8Array } | { ciphertext: Uint8Array },
  >(
    routing: {
      conversationId: string
      clientMessageId: string
      plaintext?: Uint8Array
    },
    operation: (active: OpenMlsDeviceBootstrap) => T,
  ): Promise<T & { revision: number }> {
    const active = this.active
    if (!active) throw new DeviceCryptoError('not-provisioned')
    try {
      const result = operation(active.value)
      const plaintext = 'plaintext' in result ? result.plaintext : routing.plaintext
      if (!plaintext) throw new DeviceCryptoError('operation-failed')
      const stored = await this.vault.updateWithMessageContent(
        active.userId,
        active.deviceId,
        routing.conversationId,
        routing.clientMessageId,
        plaintext,
        (key, revision) => this.seal(active.value, key, revision),
      )
      active.revision = stored.revision
      return { ...result, revision: active.revision }
    } catch (error) {
      active.value.free()
      this.active = null
      throw translateError(error)
    }
  }
}

function safeUnsignedInteger(value: bigint): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0 || BigInt(number) !== value) {
    throw new DeviceCryptoError('corrupt-state')
  }
  return number
}

function validWireBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
    && value.byteLength > 0
    && value.byteLength <= MAX_MLS_WIRE_BYTES
}

function validMessageRouting(conversationId: string, clientMessageId: string): boolean {
  return UUID_PATTERN.test(conversationId) && UUID_PATTERN.test(clientMessageId)
}
