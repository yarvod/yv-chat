# Threat model: MLS-authenticated WebRTC call identity

Status: accepted for `WP-104`; local implementation only.

## Assets and security goal

WebRTC already encrypts audio with DTLS-SRTP. The additional goal is endpoint
authentication: before a browser applies remote SDP, it must prove that the SDP
SHA-256 DTLS fingerprint belongs to a device leaf in the direct conversation's
current local MLS group. A compromised signaling service may deny service, but must
not silently terminate two independent DTLS sessions and relay decrypted audio.

The private MLS credential signing key remains sealed in the Rust/WASM device
runtime. The browser UI, FastAPI, PostgreSQL, WebSocket relay, coturn and Push never
receive it.

## Trusted components

- the local device, browser origin and sealed OpenMLS runtime;
- the locally persisted current MLS group roster and its authenticated leaf keys;
- the browser WebRTC implementation's interpretation of a strict, unambiguous
  `a=fingerprint:sha-256` SDP value.

## Adversary capabilities

The signaling adversary may read, delay, drop, replay, reorder and modify WebSocket
frames; replace SDP or ICE candidates; rewrite claimed actor ids; race answers from
multiple devices; and retain old valid call frames. TURN may observe routing metadata
and encrypted media, redirect packets or stop relaying. The adversary does not own an
authorized participant device, break Ed25519/SHA-256/DTLS-SRTP, compromise the local
origin/runtime, or extract sealed device keys.

## Required defenses

- Offer binding covers the exact conversation/call, caller user/device, callee user,
  offer role and canonical DTLS fingerprint. It intentionally leaves the callee
  device open so any current MLS device of that user can ring.
- Answer binding additionally covers the selected callee device and exact caller
  device. The first valid answer selected by the coordinator becomes the peer;
  changing its actor device invalidates verification.
- The verifier reconstructs credential identity and resolves the exact public key
  from its local MLS group. A public key or display fingerprint supplied by signaling
  is never an authentication anchor.
- Only one unique strict SHA-256 fingerprint is accepted across all SDP fingerprint
  lines. Missing, malformed, non-SHA-256 or conflicting values fail closed.
- The signed domain label and role prevent cross-protocol and offer/answer
  substitution. `call_id` prevents stale-call replay; party and conversation ids
  prevent cross-device, cross-user and cross-conversation replay.
- The safety code is derived locally from both authenticated bindings in canonical
  caller/callee order. It is never accepted from the server.
- Protocol v2 is mandatory. A v1 offer/answer is not treated as a weaker fallback.

## Residual risks and non-goals

A compromised signaling service can still block calls, suppress a valid answer,
select which concurrently ringing authorized callee device answers first, alter ICE
routes, or expose call timing and IP metadata. A compromised authorized endpoint can
record audio and make valid calls as that device until MLS membership removes it.
Users comparing the displayed code defend against implementation/local-state
failures, but the cryptographic verification does not depend on comparison.

The feature does not make this protocol identical to Telegram calls and does not
provide anonymity, traffic-analysis resistance, native background calling or group
call key management.
