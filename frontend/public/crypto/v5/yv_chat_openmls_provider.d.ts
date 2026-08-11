/* tslint:disable */
/* eslint-disable */

export class ConversationBootstrapOutput {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly commit: Uint8Array;
    readonly epoch: bigint;
    readonly ratchetTree: Uint8Array;
    readonly welcome: Uint8Array;
}

/**
 * Opaque in-memory owner of private signature and KeyPackage state.
 *
 * No plaintext serialization, private-key getter, `Debug`, `Clone`, or serde
 * implementation is provided. Browser persistence is available only through the
 * WebCrypto sealed-state methods compiled for WASM.
 */
export class DeviceBootstrap {
    free(): void;
    [Symbol.dispose](): void;
    addMembersAndMerge(conversation_id: string, serialized_key_packages: Array<any>): ConversationBootstrapOutput;
    applyCommitAndMerge(conversation_id: string, commit: Uint8Array, desired_device_ids: Array<any>): bigint;
    createConversation(conversation_id: string): bigint;
    credentialIdentity(): Uint8Array;
    fingerprint(): string;
    generateKeyPackages(count: number): Array<any>;
    joinConversation(conversation_id: string, welcome: Uint8Array, ratchet_tree: Uint8Array): bigint;
    keyPackage(): Uint8Array;
    constructor(user_id: string, device_id: string);
    protectApplicationMessage(conversation_id: string, client_message_id: string, plaintext: Uint8Array): ProtectedMessageOutput;
    static restoreSealedState(key: CryptoKey, expected_user_id: string, expected_device_id: string, expected_fingerprint: string, revision: bigint, iv: Uint8Array, ciphertext: Uint8Array): Promise<DeviceBootstrap>;
    sealState(key: CryptoKey, revision: bigint): Promise<SealedSnapshot>;
    signaturePublicKey(): Uint8Array;
    unprotectApplicationMessage(conversation_id: string, client_message_id: string, ciphertext: Uint8Array): Uint8Array;
    updateMembersAndMerge(conversation_id: string, desired_device_ids: Array<any>, serialized_key_packages: Array<any>): ConversationBootstrapOutput;
}

export class ProtectedMessageOutput {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly ciphertext: Uint8Array;
    readonly epoch: bigint;
}

export class SealedSnapshot {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly ciphertext: Uint8Array;
    readonly fingerprint: string;
    readonly iv: Uint8Array;
    readonly revision: bigint;
}

export function validatePublicKeyPackage(user_id: string, device_id: string, expected_credential_identity: Uint8Array, expected_signature_key: Uint8Array, expected_fingerprint: string, expected_package_ref: string, serialized: Uint8Array): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_conversationbootstrapoutput_free: (a: number, b: number) => void;
    readonly __wbg_devicebootstrap_free: (a: number, b: number) => void;
    readonly __wbg_protectedmessageoutput_free: (a: number, b: number) => void;
    readonly conversationbootstrapoutput_commit: (a: number) => [number, number];
    readonly conversationbootstrapoutput_epoch: (a: number) => bigint;
    readonly conversationbootstrapoutput_ratchetTree: (a: number) => [number, number];
    readonly conversationbootstrapoutput_welcome: (a: number) => [number, number];
    readonly devicebootstrap_addMembersAndMerge: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly devicebootstrap_applyCommitAndMerge: (a: number, b: number, c: number, d: number, e: number, f: any) => [bigint, number, number];
    readonly devicebootstrap_createConversation: (a: number, b: number, c: number) => [bigint, number, number];
    readonly devicebootstrap_credentialIdentity: (a: number) => [number, number];
    readonly devicebootstrap_fingerprint: (a: number) => [number, number];
    readonly devicebootstrap_generateKeyPackages: (a: number, b: number) => [number, number, number];
    readonly devicebootstrap_joinConversation: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [bigint, number, number];
    readonly devicebootstrap_keyPackage: (a: number) => [number, number];
    readonly devicebootstrap_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly devicebootstrap_protectApplicationMessage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly devicebootstrap_signaturePublicKey: (a: number) => [number, number];
    readonly devicebootstrap_unprotectApplicationMessage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly devicebootstrap_updateMembersAndMerge: (a: number, b: number, c: number, d: any, e: any) => [number, number, number];
    readonly protectedmessageoutput_ciphertext: (a: number) => [number, number];
    readonly validatePublicKeyPackage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number];
    readonly protectedmessageoutput_epoch: (a: number) => bigint;
    readonly __wbg_sealedsnapshot_free: (a: number, b: number) => void;
    readonly devicebootstrap_restoreSealedState: (a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: bigint, i: number, j: number, k: number, l: number) => any;
    readonly devicebootstrap_sealState: (a: number, b: any, c: bigint) => any;
    readonly sealedsnapshot_ciphertext: (a: number) => [number, number];
    readonly sealedsnapshot_fingerprint: (a: number) => [number, number];
    readonly sealedsnapshot_iv: (a: number) => [number, number];
    readonly sealedsnapshot_revision: (a: number) => bigint;
    readonly wasm_bindgen__convert__closures_____invoke__h680993dd3a73db18: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h5da54e24da3cad8d: (a: number, b: number, c: any, d: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
