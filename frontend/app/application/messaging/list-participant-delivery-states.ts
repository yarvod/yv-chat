import type { ConversationDeliveryStateGateway } from '../ports/conversation-delivery-state-gateway'
import type { ParticipantDeliveryState } from '../../domain/messaging/models'

export class ListParticipantDeliveryStates {
  constructor(private readonly gateway: ConversationDeliveryStateGateway) {}

  execute(): Promise<ParticipantDeliveryState[]> {
    return this.gateway.list()
  }
}
