import { ApplicationError } from '../../application/errors'

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 32_768
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export function decodeCanonicalBase64(value: string, expectedBytes?: number): Uint8Array {
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw invalidResponse()
  }
  if (
    binary.length === 0
    || (expectedBytes !== undefined && binary.length !== expectedBytes)
    || btoa(binary) !== value
  ) {
    throw invalidResponse()
  }
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function invalidResponse(): ApplicationError {
  return new ApplicationError(null, 'invalid-response', 'invalid server response')
}
