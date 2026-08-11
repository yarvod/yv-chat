/// <reference lib="webworker" />

import { DeviceCryptoError } from '../../application/device-crypto/errors'
import { IndexedDbCryptoVault } from '../storage/indexeddb-crypto-vault'
import { DeviceCryptoRuntime } from './device-crypto-runtime'
import { loadOpenMlsModule } from './openmls-module'
import {
  errorResponse,
  parseWorkerRequest,
  successResponse,
} from './worker-protocol'

const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope
let runtimePromise: Promise<DeviceCryptoRuntime> | null = null

function runtime(): Promise<DeviceCryptoRuntime> {
  runtimePromise ??= loadOpenMlsModule().then(module => new DeviceCryptoRuntime(
    module,
    new IndexedDbCryptoVault(indexedDB, crypto.subtle),
  ))
  return runtimePromise
}

scope.addEventListener('message', async (event: MessageEvent<unknown>) => {
  const request = parseWorkerRequest(event.data)
  if (!request) return

  try {
    const current = await runtime()
    if (request.type === 'dispose') {
      current.dispose()
      runtimePromise = null
      scope.postMessage(successResponse(request.requestId, { disposed: true }))
      return
    }
    let result
    if (request.type === 'checkpoint') result = await current.checkpoint()
    else if (request.type === 'provision') result = await current.provision(request.command)
    else result = await current.restore(request.command)
    const response = successResponse(request.requestId, result)
    scope.postMessage(response, {
      transfer: [
        result.credentialIdentity.buffer,
        result.signaturePublicKey.buffer,
        result.keyPackage.buffer,
      ],
    })
  } catch (error) {
    const code = error instanceof DeviceCryptoError ? error.code : 'operation-failed'
    scope.postMessage(errorResponse(request.requestId, code))
  }
})
