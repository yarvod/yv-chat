import { MessageProtectionError } from '../../application/messaging/message-protection'
import type {
  MessageProtocolAdapter,
  ProtectTextInput,
  UnprotectTextInput,
} from '../../application/ports/message-protocol-adapter'

/** Reserved protocol v2 boundary. It must fail closed until OpenMLS passes release gates. */
export class UnavailableMlsMessageProtocol implements MessageProtocolAdapter {
  readonly protocolVersion = 2
  readonly secure = true
  readonly label = 'MLS E2EE недоступно на этом устройстве'

  async protectText(_input: ProtectTextInput): Promise<string> {
    throw new MessageProtectionError('provider-unavailable')
  }

  async unprotectText(_input: UnprotectTextInput): Promise<string> {
    throw new MessageProtectionError('provider-unavailable')
  }
}
