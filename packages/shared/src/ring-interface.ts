// Contract for packages/ring/src/index.ts (owned by the ring agent).
import type { RingTransfer } from "./types";

export interface ShieldedWallet {
  keyId: string;          // local handle for the spend key (kept server-side in mock mode)
  address: string;        // visible Solana-style address (base58-ish)
  viewingKey: string;     // X25519 secret key, base64 — give to the OWNER only
  viewingPubKey: string;  // X25519 public key, base64
}

export interface DecryptedTransfer extends RingTransfer {
  amount: number;         // plaintext USDC amount, only available with a viewing key
  direction: "in" | "out";
}

/**
 * Owner audit envelope: the copy of a transfer's payload sealed to ONE address's viewing key.
 * Lets the dashboard decrypt in the browser so the viewing key never reaches the server.
 * All fields base64. Open procedure (tweetnacl):
 *   const plain = nacl.box.open(b64d(box), b64d(nonce), b64d(ephemeralPubKey), b64d(viewingSecretKey));
 *   plain === null -> not decryptable with this key; else JSON.parse(utf8(plain)) -> { amount: number, asset: "USDC", memo?: string }
 * Faucet deposits only appear for the recipient (no sender copy).
 */
export interface TransferEnvelope {
  signature: string;
  from: string;
  to: string;
  createdAt: string;
  direction: "in" | "out";   // relative to the queried address
  envelope: { nonce: string; ephemeralPubKey: string; box: string };
}

export interface Ring {
  mode: "mock" | "helius";
  createShieldedWallet(label: string): Promise<ShieldedWallet>;
  deposit(keyId: string, amount: number): Promise<RingTransfer>;          // public -> private (mock: faucet)
  transfer(args: { fromKeyId: string; to: string; amount: number; memo?: string }): Promise<RingTransfer>;
  balance(keyId: string): Promise<number>;
  listTransfers(address?: string): Promise<RingTransfer[]>;               // public explorer view
  decryptForViewer(viewingKey: string, address: string): Promise<DecryptedTransfer[]>;
  listEnvelopes?(address: string): Promise<TransferEnvelope[]>;          // optional: mock implements it; helius adapter TBD
}
// export function createRing(opts?: { mode?: "mock" | "helius"; dataDir?: string }): Ring
