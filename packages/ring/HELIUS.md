# Helius Privacy Rings adapter

`RING_MODE=helius` makes `createRing()` return `HeliusRing` (`src/helius.ts`), a real implementation of the
`Ring` interface on `@heliuslabs/spr@0.9.0-alpha` and `@solana/kit@8`. Mock mode is unchanged and still the default.

## Run it

```bash
export RING_MODE=helius
export HELIUS_API_KEY=...                      # dashboard.helius.dev
export SOLANA_PAYER_SECRET='[12,34,...]'       # 64-byte keypair, funded with devnet SOL
npm run helius:smoke                           # create -> deposit -> transfer -> balance -> viewer decrypt
npm run helius:offline                         # no network: key derivation + viewer bundle checks
```

Optional: `HELIUS_CLUSTER` (`devnet` default, or `mainnet`), `RING_ASSET_MINT` + `RING_SPL_SOURCE_ACCOUNT`
(use an SPL token such as devnet USDC instead of SOL), `RING_UNIT_BASE` (base units per 1.0 amount, default
1000000), and `HELIUS_RPC_URL` / `HELIUS_INDEXER_URL` / `HELIUS_PROVER_URL` overrides.

Endpoints come from the SDK README: Solana RPC `https://<cluster>.helius-rpc.com/?api-key=`, devnet indexer
`https://d34xe1hqb2ibg2.cloudfront.net`, devnet prover `https://dd73hh473h6ha.cloudfront.net` (mainnet:
`dgcj4pjarvo65` / `d3ky2kt0ntqxt1`). The prover is attested with `SignedTeePolicy.forNetwork(cluster)`.

## How the interface maps

| Ring method | SDK |
|---|---|
| `createShieldedWallet` | random 32-byte seed → `ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(seed))`; owner signer from the same seed; `buildRegistrationTransaction` (payer sponsors rent + fee) |
| `deposit` | `buildDepositTransaction` from the payer's public SOL (or SPL account) into the wallet's private balance |
| `transfer` | `syncWallet` → balance check → `buildTransferTransaction` to the recipient's registered Solana address; payer pays the fee, owner co-signs |
| `balance` | `syncWallet` → `wallet.balance(mint)` |
| `decryptForViewer` | `LocalKeys.fromKeys({address, viewingKeys, nullifierKey})` → `syncWallet` on a fresh read-only `Wallet` → `getPrivateTransactions` |
| `listTransfers` | transfers this service submitted (local log); `encryptedAmount` is an excerpt of the signed transaction's bytes |
| `listEnvelopes` | **not implemented** in Helius mode (see below) |

Wallet `address` is the wallet's Solana address (`shieldedAddress().solanaAddress()`), which is what transfers
are sent to. Spends on one wallet are serialized, and each spend syncs first, as the SDK requires.

Secrets: each wallet's seed is stored in `<dataDir>/helius-wallets.json` (mode 0600, `data/` is gitignored).
That is custodial, which matches the escrow decision below. Production needs a KMS or HSM.

## The owner viewing key in Helius mode

The SDK needs the viewing key **and** the nullifier key to read a wallet's history (the nullifier key is how it
detects outgoing spends). So `viewingKey` returned by `createShieldedWallet` is a bundle:
`hvk1.` + base64(JSON `{v, a: shieldedAddress, vk: viewingSecret, nk: nullifierSecret}`). It contains no signing
key, so it can read but cannot spend. It does reveal more than a pure X25519 key: anyone holding it sees the full
history, including spends.

Consequences for the rest of the app:
- `viewingPubKey` is the 33-byte SDK X25519 encoding (base64), not a tweetnacl key. `sealTo`/`openWith` (nacl box)
  will not work against it. Sealed bids in Helius mode need either a separate nacl keypair per agent or the SDK's
  own encryption.
- `listEnvelopes` (used by the dashboard's in-browser audit) is mock-only. In Helius mode, in-browser audit would
  need the SDK running in the browser (`@heliuslabs/spr` supports browsers) with the bundle above.

## Escrow: can a program hold a private balance?

**Yes, in the protocol, experimentally.** The installed SDK ships `@heliuslabs/spr/program`, documented as
"experimental clients for ZK programs that own SPP UTXOs": `ShieldedPda` (a PDA identity with viewing and nullifier
keys but no signing secret), `ProgramOwner.find(seeds, programId)`, `bindProgramTransaction`, and
`transactCpiAccounts` for a CPI into the pool's `transact`. So a Solana program can own private notes and release
them by CPI.

**But it is not usable for Spawnpad yet:** the program must be a ZK program with its own circuit and generated
transactions, every export is marked "may change in any release", and there is no documented escrow example in
the SDK. I did not fetch `helius-labs/zolana-examples` (no web access in this run), so its escrow program is unread.

**Decision:** keep the custodial escrow wallet (what the API already does): escrow and treasury are ordinary
`HeliusRing` wallets whose seeds the server holds. Program-owned escrow is the upgrade path once the program API
stabilises.

## Verified vs not verified

Verified here (no API key needed):
- `tsc --strict` passes for `helius.ts`, `helius-smoke.ts`, `helius-offline-check.ts`, `index.ts`.
- Every SDK call matches the installed 0.9.0-alpha typings (read from `dist/*.d.ts`, not the docs).
- Offline check passes: the shielded keypair's Solana address equals the kit signer's address from the same seed;
  the viewer bundle round-trips (address, viewing key and nullifier key load) and contains no signing key.
- Mock mode is unaffected: `npm run selftest` still passes.
- With no env, `helius:smoke` explains what's needed and exits 0.

Not verified (needs `HELIUS_API_KEY` and a funded devnet payer):
- Any devnet transaction: registration, deposit, transfer, sync, balance, viewer decryption.
- That the public devnet indexer/prover URLs in the SDK README are still live, and that prover attestation succeeds.
- Whether `wallet.balance(SOL_MINT)` works before the first sync (it may need the asset registry backfilled).
- SPL (USDC) deposits and the exact source-account requirements.
- History timing: `getPrivateTransactions` rows have no timestamp, so `createdAt` comes from the local log
  (epoch 0 for rows this service did not submit).
