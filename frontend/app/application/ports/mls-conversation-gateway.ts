/** Intent-level MLS operations owned by the isolated crypto runtime. */

export interface BootstrapMlsConversationCommand {
  readonly conversationId: string
  readonly keyPackages: readonly Uint8Array[]
}

export interface BootstrapMlsConversationResult {
  readonly commit: Uint8Array
  readonly welcome: Uint8Array
  readonly ratchetTree: Uint8Array
  readonly epoch: number
  readonly revision: number
}

export interface JoinMlsConversationCommand {
  readonly conversationId: string
  readonly welcome: Uint8Array
  readonly ratchetTree: Uint8Array
}

export interface MlsConversationStateResult {
  readonly epoch: number
  readonly revision: number
}

export interface InspectMlsConversationCommand {
  readonly conversationId: string
}

export interface MlsConversationInspectionResult {
  readonly epoch: number | null
  readonly deviceIds: readonly string[]
  readonly revision: number
}

export interface UpdateMlsConversationCommand {
  readonly conversationId: string
  readonly desiredDeviceIds: readonly string[]
  readonly keyPackages: readonly Uint8Array[]
}

export interface UpdateMlsConversationResult {
  readonly commit: Uint8Array
  readonly welcome: Uint8Array | null
  readonly ratchetTree: Uint8Array
  readonly epoch: number
  readonly revision: number
}

export interface ApplyMlsCommitCommand {
  readonly conversationId: string
  readonly commit: Uint8Array
  readonly desiredDeviceIds: readonly string[]
}

export interface ProtectMlsMessageCommand {
  readonly conversationId: string
  readonly clientMessageId: string
  readonly plaintext: Uint8Array
}

export interface ProtectMlsMessageResult extends MlsConversationStateResult {
  readonly ciphertext: Uint8Array
}

export interface UnprotectMlsMessageCommand {
  readonly conversationId: string
  readonly clientMessageId: string
  readonly ciphertext: Uint8Array
}

export interface UnprotectMlsMessageResult {
  readonly plaintext: Uint8Array
  readonly revision: number
}

export interface MlsConversationGateway {
  inspectConversation(
    command: InspectMlsConversationCommand,
  ): Promise<MlsConversationInspectionResult>
  bootstrapConversation(
    command: BootstrapMlsConversationCommand,
  ): Promise<BootstrapMlsConversationResult>
  joinConversation(command: JoinMlsConversationCommand): Promise<MlsConversationStateResult>
  rejoinConversation(command: JoinMlsConversationCommand): Promise<MlsConversationStateResult>
  updateConversation(command: UpdateMlsConversationCommand): Promise<UpdateMlsConversationResult>
  applyCommit(command: ApplyMlsCommitCommand): Promise<MlsConversationStateResult>
  protectMessage(command: ProtectMlsMessageCommand): Promise<ProtectMlsMessageResult>
  unprotectMessage(command: UnprotectMlsMessageCommand): Promise<UnprotectMlsMessageResult>
}
