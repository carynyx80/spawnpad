// Spawnpad privacy ring adapter. Mock mode uses real X25519 (nacl.box) encryption of amounts,
// mirroring the default Helius Privacy Ring: addresses visible, amounts encrypted.
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import bs58 from "bs58";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RingTransfer } from "../../shared/src/types.ts";
import type { Ring, ShieldedWallet, DecryptedTransfer, TransferEnvelope } from "../../shared/src/ring-interface.ts";
import { HeliusRing } from "./helius.ts";

export type { Ring, ShieldedWallet, DecryptedTransfer, RingTransfer, TransferEnvelope };

const { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } = naclUtil;
const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = resolve(here, "../../../data");

interface Sealed { nonce: string; ephemeralPub: string; box: string }
interface StoredWallet { keyId: string; label: string; address: string; viewingKey: string; viewingPubKey: string; balance: number }
interface StoredTransfer extends RingTransfer {
  kind: "deposit" | "transfer" | "withdraw";
  sealedForSender?: Sealed;   // undefined for deposits (faucet has no viewing key)
  sealedForRecipient?: Sealed; // undefined for withdrawals (recipient is an outside wallet)
}
interface State { wallets: StoredWallet[]; transfers: StoredTransfer[] }

export const FAUCET_ADDRESS = "RingFaucetDevnet1111111111111111111111111111";

function seal(payload: object, recipientPubB64: string): Sealed {
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(decodeUTF8(JSON.stringify(payload)), nonce, decodeBase64(recipientPubB64), eph.secretKey);
  return { nonce: encodeBase64(nonce), ephemeralPub: encodeBase64(eph.publicKey), box: encodeBase64(box) };
}

function open(sealed: Sealed, secretB64: string): any | null {
  try {
    const out = nacl.box.open(decodeBase64(sealed.box), decodeBase64(sealed.nonce), decodeBase64(sealed.ephemeralPub), decodeBase64(secretB64));
    return out ? JSON.parse(encodeUTF8(out)) : null;
  } catch { return null; }
}

/** Seal arbitrary JSON to an X25519 public key (used for sealed bids / budgets too). */
export function sealTo(viewingPubKey: string, payload: object): string {
  return encodeBase64(decodeUTF8(JSON.stringify(seal(payload, viewingPubKey))));
}
/** Open a value produced by sealTo with the matching viewing (secret) key. Returns null if it can't. */
export function openWith(viewingKey: string, sealedB64: string): any | null {
  try { return open(JSON.parse(encodeUTF8(decodeBase64(sealedB64))), viewingKey); } catch { return null; }
}

const rand58 = (n: number) => bs58.encode(nacl.randomBytes(n));
const publicView = ({ signature, from, to, encryptedAmount, memo, createdAt }: StoredTransfer): RingTransfer =>
  ({ signature, from, to, encryptedAmount, ...(memo ? { memo } : {}), createdAt });

class MockRing implements Ring {
  mode = "mock" as const;
  private file: string;
  private state: State;

  constructor(dataDir: string) {
    this.file = resolve(dataDir, "ring.json");
    mkdirSync(dataDir, { recursive: true });
    this.state = existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : { wallets: [], transfers: [] };
  }
  private save() { writeFileSync(this.file, JSON.stringify(this.state, null, 2)); }
  private wallet(keyId: string) {
    const w = this.state.wallets.find((w) => w.keyId === keyId);
    if (!w) throw new Error(`unknown keyId ${keyId}`);
    return w;
  }

  async createShieldedWallet(label: string): Promise<ShieldedWallet> {
    const kp = nacl.box.keyPair();
    const w: StoredWallet = {
      keyId: `key_${rand58(12)}`, label, address: rand58(32),
      viewingKey: encodeBase64(kp.secretKey), viewingPubKey: encodeBase64(kp.publicKey), balance: 0,
    };
    this.state.wallets.push(w); this.save();
    return { keyId: w.keyId, address: w.address, viewingKey: w.viewingKey, viewingPubKey: w.viewingPubKey };
  }

  async deposit(keyId: string, amount: number): Promise<RingTransfer> {
    if (!(amount > 0)) throw new Error("amount must be positive");
    const w = this.wallet(keyId);
    const sealedForRecipient = seal({ amount, asset: "USDC" }, w.viewingPubKey);
    const t: StoredTransfer = {
      kind: "deposit", signature: rand58(64), from: FAUCET_ADDRESS, to: w.address,
      encryptedAmount: sealedForRecipient.box, sealedForRecipient, memo: "devnet faucet", createdAt: new Date().toISOString(),
    };
    w.balance += amount; this.state.transfers.push(t); this.save();
    return publicView(t);
  }

  async transfer({ fromKeyId, to, amount, memo }: { fromKeyId: string; to: string; amount: number; memo?: string }): Promise<RingTransfer> {
    if (!(amount > 0)) throw new Error("amount must be positive");
    const from = this.wallet(fromKeyId);
    const dest = this.state.wallets.find((w) => w.address === to);
    if (!dest) throw new Error(`unknown recipient address ${to}`);
    if (from.balance < amount) throw new Error("insufficient private balance");
    const payload = { amount, asset: "USDC", memo };
    const sealedForSender = seal(payload, from.viewingPubKey);
    const sealedForRecipient = seal(payload, dest.viewingPubKey);
    const t: StoredTransfer = {
      kind: "transfer", signature: rand58(64), from: from.address, to: dest.address,
      encryptedAmount: sealedForRecipient.box, sealedForSender, sealedForRecipient, createdAt: new Date().toISOString(),
    };
    from.balance -= amount; dest.balance += amount; this.state.transfers.push(t); this.save();
    return publicView(t);
  }

  /** Mock withdrawal: debits the wallet and records the payout to an outside address (sender copy only). */
  async withdraw({ fromKeyId, to, amount, memo }: { fromKeyId: string; to: string; amount: number; memo?: string }): Promise<RingTransfer> {
    if (!(amount > 0)) throw new Error("amount must be positive");
    const from = this.wallet(fromKeyId);
    if (from.balance < amount) throw new Error("insufficient private balance");
    const sealedForSender = seal({ amount, asset: "USDC", memo }, from.viewingPubKey);
    const t: StoredTransfer = {
      kind: "withdraw", signature: rand58(64), from: from.address, to,
      encryptedAmount: sealedForSender.box, sealedForSender, createdAt: new Date().toISOString(),
    };
    from.balance -= amount; this.state.transfers.push(t); this.save();
    return publicView(t);
  }

  async balance(keyId: string) { return this.wallet(keyId).balance; }

  async listTransfers(address?: string): Promise<RingTransfer[]> {
    return this.state.transfers.filter((t) => !address || t.from === address || t.to === address).map(publicView);
  }

  async listEnvelopes(address: string): Promise<TransferEnvelope[]> {
    const out: TransferEnvelope[] = [];
    for (const t of this.state.transfers) {
      const sealed = t.to === address ? t.sealedForRecipient : t.from === address ? t.sealedForSender : undefined;
      if (!sealed) continue; // e.g. faucet deposits have no sender copy
      out.push({ signature: t.signature, from: t.from, to: t.to, createdAt: t.createdAt,
        direction: t.to === address ? "in" : "out",
        envelope: { nonce: sealed.nonce, ephemeralPubKey: sealed.ephemeralPub, box: sealed.box } });
    }
    return out;
  }

  async decryptForViewer(viewingKey: string, address: string): Promise<DecryptedTransfer[]> {
    const out: DecryptedTransfer[] = [];
    for (const t of this.state.transfers) {
      let p: any = null; let direction: "in" | "out" | null = null;
      if (t.to === address && t.sealedForRecipient) { p = open(t.sealedForRecipient, viewingKey); direction = "in"; }
      if (!p && t.from === address && t.sealedForSender) { p = open(t.sealedForSender, viewingKey); direction = "out"; }
      if (p && direction) out.push({ ...publicView(t), ...(p.memo ? { memo: p.memo } : {}), amount: p.amount, direction });
    }
    return out;
  }
}

export function createRing(opts: { mode?: "mock" | "helius"; dataDir?: string } = {}): Ring {
  const mode = opts.mode ?? (process.env.RING_MODE as "mock" | "helius" | undefined) ?? "mock";
  if (mode === "helius") {
    // Real Solana Privacy Rings (devnet by default). The alpha SDK loads lazily on first call. See HELIUS.md.
    return new HeliusRing(opts.dataDir ?? process.env.RING_DATA_DIR ?? DEFAULT_DATA_DIR);
  }
  return new MockRing(opts.dataDir ?? process.env.RING_DATA_DIR ?? DEFAULT_DATA_DIR);
}

export { HeliusRing, heliusEnv, createHeliusRing } from "./helius.ts";
