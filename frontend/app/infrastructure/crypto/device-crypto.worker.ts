/// <reference lib="webworker" />

import { DeviceCryptoError } from '../../application/device-crypto/errors'
import { IndexedDbCryptoVault } from '../storage/indexeddb-crypto-vault'
import { DeviceCryptoRuntime } from './device-crypto-runtime'
import { loadOpenMlsModule } from './openmls-module'
import { mlsResultTransferables, type MlsWorkerResult } from './mls-worker-protocol'
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
    else if (request.type === 'restore') result = await current.restore(request.command)
    else if (request.type === 'validate-key-package') {
      result = await current.validateKeyPackage(request.command)
    } else if (request.type === 'generate-key-packages') {
      result = await current.generateKeyPackages(request.command)
    } else if (request.type === 'mls-bootstrap') {
      result = await current.bootstrapConversation(request.command)
    } else if (request.type === 'mls-join') {
      result = await current.joinConversation(request.command)
    } else if (request.type === 'mls-update') {
      result = await current.updateConversation(request.command)
    } else if (request.type === 'mls-apply-commit') {
      result = await current.applyCommit(request.command)
    } else if (request.type === 'mls-protect') {
      result = await current.protectMessage(request.command)
    } else {
      result = await current.unprotectMessage(request.command)
    }
    const response = successResponse(request.requestId, result)
    const transfer = 'credentialIdentity' in result
      ? [result.credentialIdentity.buffer, result.signaturePublicKey.buffer, result.keyPackage.buffer]
      : 'keyPackages' in result ? result.keyPackages.map(item => item.buffer)
      : isMlsResult(result) ? mlsResultTransferables(result) : []
    scope.postMessage(response, { transfer })
  } catch (error) {
    const code = error instanceof DeviceCryptoError ? error.code : 'operation-failed'
    scope.postMessage(errorResponse(request.requestId, code))
  }
})

function isMlsResult(value: object): value is MlsWorkerResult {
  return 'revision' in value && !('credentialIdentity' in value)
}
