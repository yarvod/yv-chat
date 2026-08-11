export interface ServerHealthGateway {
  probe(): Promise<void>
}
