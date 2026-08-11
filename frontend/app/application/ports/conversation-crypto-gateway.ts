export type ConversationCryptoStatus = 'blocked' | 'pending' | 'ready'

export type ConversationCryptoBlockReason =
  | 'missing_identity'
  | 'missing_key_package'
  | 'membership_changed'
  | 'device_roster_changed'
  | 'coordinator_revoked'
  | 'protocol_failure'

export interface RequiredConversationCryptoDevice {
  readonly userId: string
  readonly deviceId: string
  readonly isCoordinator: boolean
  readonly fingerprint: string | null
  readonly credentialIdentity: Uint8Array | null
  readonly signaturePublicKey: Uint8Array | null
  readonly keyPackageRef: string | null
  readonly keyPackage: Uint8Array | null
}

export interface ConversationCryptoWelcome {
  readonly targetDeviceId: string
  readonly welcome: Uint8Array
  readonly createdAt: string
  readonly expiresAt: string
  readonly acknowledgedAt: string | null
}

export interface ConversationCryptoGeneration {
  readonly generationId: string
  readonly conversationId: string
  readonly generationNumber: number
  readonly protocolVersion: 2
  readonly status: ConversationCryptoStatus
  readonly blockReason: ConversationCryptoBlockReason | null
  readonly coordinatorDeviceId: string
  readonly epoch: number | null
  readonly commit: Uint8Array | null
  readonly ratchetTree: Uint8Array | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly readyAt: string | null
  readonly requiredDevices: readonly RequiredConversationCryptoDevice[]
  readonly welcome: ConversationCryptoWelcome | null
}

export interface FinalizeConversationCryptoCommand {
  readonly conversationId: string
  readonly generationId: string
  readonly epoch: number
  readonly commit: Uint8Array
  readonly ratchetTree: Uint8Array
  readonly welcomes: readonly {
    readonly targetDeviceId: string
    readonly welcome: Uint8Array
  }[]
}

export interface ConversationCryptoGateway {
  getCurrent(conversationId: string): Promise<ConversationCryptoGeneration | null>
  listReadyAfter(
    conversationId: string,
    afterGenerationNumber: number,
  ): Promise<readonly ConversationCryptoGeneration[]>
  begin(conversationId: string, bootstrapRequestId: string): Promise<ConversationCryptoGeneration>
  finalize(command: FinalizeConversationCryptoCommand): Promise<ConversationCryptoGeneration>
  acknowledgeWelcome(conversationId: string, generationId: string): Promise<void>
}
