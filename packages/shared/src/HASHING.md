# Hashing rules (binding for sdk, api, verifier)
- testsHash = sha256 hex of the base64-DECODED tests bytes (the UTF-8 JSON text).
- deliverableHash = sha256 hex of the base64-DECODED payloadForVerifier bytes.
- specHash = sha256 hex of canonical JSON (keys sorted recursively, no whitespace) of `spec`.
- Attestation signature = ed25519 over canonical JSON (keys sorted recursively, no whitespace) of the attestation minus `signature`.
