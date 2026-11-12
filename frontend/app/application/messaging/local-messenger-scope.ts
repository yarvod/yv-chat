/** Both IDs are canonical UUIDs; the prefix separates old account-only records. */
export function localMessengerScope(userId: string, deviceId: string): string {
  return `device:${userId}:${deviceId}`
}
