export interface CallBindingCommand {
  role: 'offer' | 'answer'
  conversationId: string
  callId: string
  callerUserId: string
  callerDeviceId: string
  calleeUserId: string
  calleeDeviceId: string | null
  sdp: string
}

export interface CallBindingSignatureResult {
  signature: Uint8Array
}

export interface CallBindingVerificationResult {
  verified: true
}

export interface CallVerificationCodeCommand {
  conversationId: string
  callId: string
  callerUserId: string
  callerDeviceId: string
  calleeUserId: string
  calleeDeviceId: string
  offerSdp: string
  offerSignature: Uint8Array
  answerSdp: string
  answerSignature: Uint8Array
}

export interface CallVerificationCodeResult {
  code: string
}

export interface CallIdentityGateway {
  signCallBinding(command: CallBindingCommand): Promise<CallBindingSignatureResult>
  verifyCallBinding(command: CallBindingCommand & {
    signature: Uint8Array
  }): Promise<CallBindingVerificationResult>
  deriveCallVerificationCode(
    command: CallVerificationCodeCommand,
  ): Promise<CallVerificationCodeResult>
}
