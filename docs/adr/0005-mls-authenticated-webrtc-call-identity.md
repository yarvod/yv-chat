# ADR-0005: Bind WebRTC DTLS fingerprints to MLS device identities

Status: accepted for local implementation (`WP-104`)

## Context

DTLS-SRTP encrypts current voice media, but unauthenticated SDP arrives through the
application signaling server. Browser certificate fingerprints therefore protect
transport only: a compromised relay could substitute two fingerprints and establish
two different encrypted calls. The messenger already has per-device Ed25519
credential keys authenticated as OpenMLS leaves.

## Decision

Introduce call signaling protocol version 2. The sealed OpenMLS runtime signs a
domain-separated canonical call binding with the existing MLS credential signing
key and verifies remote signatures with the exact leaf key resolved from the local
group roster.

The canonical binary input uses fixed-width UUID bytes and fixed fields:

```text
"yv-chat-webrtc-call-binding-v1\0"
role (offer=1, answer=2)
conversation UUID
call UUID
caller user UUID
caller device UUID
callee user UUID
callee device UUID (all zero for an offer; exact device for an answer)
32-byte SHA-256 DTLS certificate fingerprint
```

SDP parsing accepts one unique fingerprint value, repeated identically when browser
SDP contains media-level copies. The only accepted grammar is SHA-256 with exactly
32 colon-separated bytes. The v2 wire frame carries SDP plus a bounded lowercase
hex signature; it does not carry a trusted public key.

Offer verification happens before ringing and before `setRemoteDescription`.
Answer verification happens before the caller applies the answer. A failure ends the
attempt as a security error; there is no v1 retry.

After a valid answer, both devices derive the comparison code as SHA-256 over a
separate domain label plus the canonical offer binding, offer signature, canonical
answer binding and answer signature. The UI formats the same digest prefix into
decimal groups. The code is an independently computed comparison aid, not a server
assertion.

## Key-use rationale

Ed25519 credential keys are already general signing keys used to authenticate MLS
leaf operations. External call bindings use a project-specific prefix that cannot be
parsed as an MLS protocol signature input. This avoids exporting private keys or
adding a second unauthenticated call key. A future dedicated call subkey would need
its own MLS-authenticated distribution and rotation ADR.

## Consequences

- Signaling compromise becomes denial-of-service rather than silent WebRTC MITM for
  calls between uncompromised current MLS devices.
- Calls fail closed while local MLS state is missing/stale or the expected device is
  absent; the UI must not claim verified identity in that state.
- Any callee device in the MLS group can verify an offer, while the answer identifies
  the exact winning device. This preserves existing multi-device ringing semantics.
- v2 requires a coordinated frontend/backend rollout. Because `WP-104` is local-only,
  production remains on v1 until a separate rollout window updates both atomically.
- ICE candidates remain unsigned because changing them cannot change the authenticated
  DTLS endpoint; a malicious relay can reroute/drop traffic but cannot forge media
  authentication.
