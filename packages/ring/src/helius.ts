// Helius Solana Privacy Rings adapter on @heliuslabs/spr (0.9.0-alpha) + @solana/kit 8.
// Implements the Ring interface against devnet (or mainnet) with a custodial key per wallet.
// See ../HELIUS.md for env vars, units, the escrow decision and what is / isn't verified.
//
// Mapping:
//   createShieldedWallet -> ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(seed)) + buildRegistrationTransaction
//   deposit              -> buildDepositTransaction (payer's public SOL/SPL -> recipient's private balance)
//   transfer             -> syncWallet -> buildTransferTransaction (recipient = registered Solana address)
//   balance              -> syncWallet -> wallet.balance(mint)
//   decryptForViewer     -> LocalKeys.fromKeys({address, viewingKeys, nullifierKey}) -> syncWallet -> getPrivateTransactions
// Proofs go to Helius' attested Nitro-enclave prover (SignedTeePolicy.forNetwork). The prover sees plaintext inputs.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import bs58 from "bs58";
import type * as SprNS from "@heliuslabs/spr";
import type * as KitNS from "@solana/kit";
import type { Ring, ShieldedWallet, DecryptedTransfer } from "../../shared/src/ring-interface.ts";
import type { RingTransfer } from "../../shared/src/types.ts";

type Spr = typeof SprNS;
type Kit = typeof KitNS;
type KeyPairSigner = KitNS.KeyPairSigner;

export const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const VK_PREFIX = "hvk1.";

const ENDPOINTS = {
  devnet: { indexer: "https://d34xe1hqb2ibg2.cloudfront.net", prover: "https://dd73hh473h6ha.cloudfront.net" },
  mainnet: { indexer: "https://dgcj4pjarvo65.cloudfront.net", prover: "https://d3ky2kt0ntqxt1.cloudfront.net" },
} as const;

export interface HeliusEnv {
  apiKey: string;
  payerSecret: string;
  cluster: "devnet" | "mainnet";
  assetMint?: string;          // unset = SOL
  splSourceAccount?: string;   // payer's token account, required for SPL deposits
  unitBase: bigint;            // base units per 1.0 Ring amount
}

/** Reads env. Returns the list of missing variables instead of throwing, so callers can explain. */
export function heliusEnv(): { env?: HeliusEnv; missing: string[] } {
  const missing: string[] = [];
  const apiKey = process.env.HELIUS_API_KEY;
  const payerSecret = process.env.SOLANA_PAYER_SECRET;
  if (!apiKey) missing.push("HELIUS_API_KEY");
  if (!payerSecret) missing.push("SOLANA_PAYER_SECRET");
  const cluster = (process.env.HELIUS_CLUSTER ?? "devnet") as "devnet" | "mainnet";
  const assetMint = process.env.RING_ASSET_MINT || undefined;
  if (missing.length) return { missing };
  return {
    missing,
    env: {
      apiKey: apiKey!, payerSecret: payerSecret!, cluster, assetMint,
      splSourceAccount: process.env.RING_SPL_SOURCE_ACCOUNT || undefined,
      unitBase: BigInt(process.env.RING_UNIT_BASE ?? "1000000"),
    },
  };
}

interface StoredWallet { keyId: string; label: string; seed: string; address: string; createdAt: string }
interface LogEntry { signature: string; from: string; to: string; memo?: string; cipher: string; createdAt: string; kind: "deposit" | "transfer" | "withdraw" }
interface Store { wallets: StoredWallet[]; log: LogEntry[] }

type SprClient = Awaited<ReturnType<Spr["createSprClient"]>>;
interface Ctx {
  spr: Spr; kit: Kit; client: SprClient; payer: KeyPairSigner; env: HeliusEnv;
  send: (tx: KitNS.Transaction, signers: KeyPairSigner[]) => Promise<{ signature: string; slot: bigint; cipher: string }>;
}

interface Handle {
  stored: StoredWallet;
  keypair: SprNS.ShieldedKeypair;
  owner: KeyPairSigner;
  wallet: SprNS.Wallet;
  keys: SprNS.LocalKeys;
  lastSlot?: bigint;
  queue: Promise<unknown>;
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

function parsePayerSecret(s: string): Uint8Array {
  const t = s.trim();
  const bytes = t.startsWith("[") ? Uint8Array.from(JSON.parse(t) as number[]) : bs58.decode(t);
  if (bytes.length !== 64) throw new Error("SOLANA_PAYER_SECRET must be a 64-byte keypair (solana-keygen JSON array or base58)");
  return bytes;
}

/** Owner audit key in Helius mode: viewing key + nullifier key + shielded address. Read-only: cannot sign spends. */
export function encodeViewerBundle(kp: SprNS.ShieldedKeypair): string {
  return VK_PREFIX + b64(new TextEncoder().encode(JSON.stringify({
    v: 1,
    a: b64(kp.shieldedAddress().toBytes()),
    vk: b64(kp.viewingKey().secretBytes()),
    nk: b64(kp.nullifierKey().secretBytes()),
  })));
}
function decodeViewerBundle(s: string): { a: Uint8Array; vk: Uint8Array; nk: Uint8Array } | null {
  if (!s.startsWith(VK_PREFIX)) return null;
  try {
    const j = JSON.parse(Buffer.from(s.slice(VK_PREFIX.length), "base64").toString("utf8"));
    return { a: unb64(j.a), vk: unb64(j.vk), nk: unb64(j.nk) };
  } catch { return null; }
}

export class HeliusRing implements Ring {
  readonly mode = "helius" as const;
  private file: string;
  private store: Store;
  private handles = new Map<string, Handle>();
  private init?: Promise<Ctx>;

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "helius-wallets.json");
    this.store = existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : { wallets: [], log: [] };
  }

  private save() {
    writeFileSync(this.file, JSON.stringify(this.store, null, 2));
    try { chmodSync(this.file, 0o600); } catch { /* best effort */ }
  }

  private ready() {
    if (!this.init) this.init = (async () => {
      const { env, missing } = heliusEnv();
      if (!env) throw new Error(`helius ring: missing env ${missing.join(", ")}`);
      const spr: Spr = await import("@heliuslabs/spr");
      const { SignedTeePolicy } = await import("@heliuslabs/spr/client");
      const kit: Kit = await import("@solana/kit");
      const ep = ENDPOINTS[env.cluster];
      const client = await spr.createSprClient({
        solanaRpcUrl: process.env.HELIUS_RPC_URL ?? `https://${env.cluster}.helius-rpc.com/?api-key=${env.apiKey}`,
        indexerUrl: process.env.HELIUS_INDEXER_URL ?? ep.indexer,
        proverUrl: process.env.HELIUS_PROVER_URL ?? ep.prover,
        apiKey: env.apiKey,
        proverTee: SignedTeePolicy.forNetwork(env.cluster),
      });
      const payer = await kit.createKeyPairSignerFromBytes(parsePayerSecret(env.payerSecret));
      const sendAndConfirm = kit.sendAndConfirmTransactionFactory({ rpc: client.solanaRpc, rpcSubscriptions: client.solanaRpcSubscriptions } as any);
      const send = async (tx: KitNS.Transaction, signers: KeyPairSigner[]) => {
        const signed = await kit.signTransactionWithSigners(signers, tx);
        await sendAndConfirm(signed as any, { commitment: "confirmed" });
        const signature = kit.getSignatureFromTransaction(signed);
        const slot = await client.confirmTransaction(signature);
        // Public-view excerpt: the tail of the signed message, which carries the encrypted outputs.
        const mb = new Uint8Array(signed.messageBytes as unknown as ArrayLike<number>);
        return { signature, slot, cipher: b64(mb.slice(Math.max(0, mb.length - 48))) };
      };
      return { spr, kit, client, payer, env, send };
    })();
    return this.init;
  }

  private async handle(keyId: string): Promise<Handle> {
    const h = this.handles.get(keyId);
    if (h) return h;
    const stored = this.store.wallets.find(w => w.keyId === keyId);
    if (!stored) throw new Error(`unknown keyId ${keyId}`);
    const { spr, kit, client } = await this.ready();
    const seed = unb64(stored.seed);
    const keypair = spr.ShieldedKeypair.fromKeypair(spr.SigningKey.fromEd25519Bytes(seed.slice() as any));
    const owner = await kit.createKeyPairSignerFromPrivateKeyBytes(seed.slice());
    const wallet = new spr.Wallet({ identity: keypair.shieldedAddress() });
    const keys = spr.LocalKeys.fromKeypair(keypair, client.proofService);
    const nh: Handle = { stored, keypair, owner, wallet, keys, queue: Promise.resolve() };
    this.handles.set(keyId, nh);
    return nh;
  }

  /** Serialize work per wallet: the SDK forbids building a spend before syncing past the previous one. */
  private serial<T>(h: Handle, fn: () => Promise<T>): Promise<T> {
    const run = h.queue.then(fn, fn);
    h.queue = run.catch(() => undefined);
    return run;
  }

  private async sync(h: Handle) {
    const { spr, client } = await this.ready();
    await spr.syncWallet({ client, wallet: h.wallet, keys: h.keys, config: h.lastSlot ? { requireSlot: h.lastSlot } : undefined });
  }

  private mint(spr: Spr, env: HeliusEnv) { return (env.assetMint ?? spr.SOL_MINT) as KitNS.Address; }
  private toBase(n: number, env: HeliusEnv) {
    if (!(n > 0) || !Number.isFinite(n)) throw new Error("amount must be positive");
    return BigInt(Math.round(n * Number(env.unitBase)));
  }
  private fromBase(n: bigint, env: HeliusEnv) { return Number(n) / Number(env.unitBase); }

  async createShieldedWallet(label: string): Promise<ShieldedWallet> {
    const { spr, kit, client, payer, send } = await this.ready();
    const seed = new Uint8Array(randomBytes(32));
    const keypair = spr.ShieldedKeypair.fromKeypair(spr.SigningKey.fromEd25519Bytes(seed.slice() as any));
    const owner = await kit.createKeyPairSignerFromPrivateKeyBytes(seed.slice());
    const reg = await spr.buildRegistrationTransaction({ client, owner: owner.address, address: keypair.shieldedAddress(), payer: payer.address });
    if (reg) await send(reg, [payer, owner]);
    const keyId = `hk_${b64(randomBytes(9)).replace(/[+/=]/g, "")}`;
    this.store.wallets.push({ keyId, label, seed: b64(seed), address: owner.address, createdAt: new Date().toISOString() });
    this.save();
    const vpk = keypair.viewingPublicKey().toBytes();
    const out = { keyId, address: owner.address as string, viewingKey: encodeViewerBundle(keypair), viewingPubKey: b64(vpk) };
    keypair.destroy();
    seed.fill(0);
    return out;
  }

  async deposit(keyId: string, amount: number): Promise<RingTransfer> {
    if (process.env.RING_ASSET_MINT && !process.env.RING_SPL_SOURCE_ACCOUNT) throw new Error("RING_SPL_SOURCE_ACCOUNT is required for SPL deposits");
    const { spr, client, payer, env, send } = await this.ready();
    const h = await this.handle(keyId);
    return this.serial(h, async () => {
      const tx = await spr.buildDepositTransaction({
        client, feePayer: payer.address, recipient: h.keypair.shieldedAddress(), amount: this.toBase(amount, env),
        ...(env.assetMint ? { asset: env.assetMint as KitNS.Address, splTokenAccount: env.splSourceAccount as KitNS.Address } : {}),
      });
      const r = await send(tx, [payer]);
      h.lastSlot = r.slot;
      return this.log({ signature: r.signature, from: payer.address, to: h.stored.address, cipher: r.cipher, kind: "deposit", memo: "devnet deposit" });
    });
  }

  async transfer(args: { fromKeyId: string; to: string; amount: number; memo?: string }): Promise<RingTransfer> {
    const { spr, client, payer, env, send } = await this.ready();
    const h = await this.handle(args.fromKeyId);
    const amount = this.toBase(args.amount, env);
    return this.serial(h, async () => {
      await this.sync(h);
      const mint = this.mint(spr, env);
      if (h.wallet.balance(mint).amount < amount) throw new Error("insufficient private balance");
      const tx = await spr.buildTransferTransaction({
        client, wallet: h.wallet, keys: h.keys, feePayer: payer.address, recipient: args.to as KitNS.Address, amount,
        ...(env.assetMint ? { asset: mint } : {}),
      });
      const r = await send(tx, [payer, h.owner]);
      h.lastSlot = r.slot;
      const rec = this.store.wallets.find(w => w.address === args.to);
      const rh = rec && this.handles.get(rec.keyId);
      if (rh) rh.lastSlot = r.slot;
      return this.log({ signature: r.signature, from: h.stored.address, to: args.to, cipher: r.cipher, kind: "transfer", memo: args.memo });
    });
  }

  /** Withdraw from the private balance to an ordinary Solana wallet (SPL: the recipient's associated token account). */
  async withdraw(args: { fromKeyId: string; to: string; amount: number; memo?: string }): Promise<RingTransfer> {
    const { spr, client, payer, env, send } = await this.ready();
    const h = await this.handle(args.fromKeyId);
    const amount = this.toBase(args.amount, env);
    return this.serial(h, async () => {
      await this.sync(h);
      const mint = this.mint(spr, env);
      if (h.wallet.balance(mint).amount < amount) throw new Error("insufficient private balance");
      const tx = await spr.buildWithdrawalTransaction({
        client, wallet: h.wallet, keys: h.keys, feePayer: payer.address, recipient: args.to as KitNS.Address, amount,
        ...(env.assetMint ? { asset: mint } : {}),
      });
      const r = await send(tx, [payer, h.owner]);
      h.lastSlot = r.slot;
      return this.log({ signature: r.signature, from: h.stored.address, to: args.to, cipher: r.cipher, kind: "withdraw", memo: args.memo });
    });
  }

  async balance(keyId: string): Promise<number> {
    const { spr, env } = await this.ready();
    const h = await this.handle(keyId);
    return this.serial(h, async () => { await this.sync(h); return this.fromBase(h.wallet.balance(this.mint(spr, env)).amount, env); });
  }

  private log(e: Omit<LogEntry, "createdAt">): RingTransfer {
    const entry: LogEntry = { ...e, createdAt: new Date().toISOString() };
    this.store.log.push(entry);
    this.save();
    return { signature: entry.signature, from: entry.from, to: entry.to, encryptedAmount: entry.cipher, createdAt: entry.createdAt };
  }

  /** Public view: transfers this service submitted. Amounts are only the on-chain ciphertext excerpt. */
  async listTransfers(address?: string): Promise<RingTransfer[]> {
    return this.store.log
      .filter(t => !address || t.from === address || t.to === address)
      .map(t => ({ signature: t.signature, from: t.from, to: t.to, encryptedAmount: t.cipher, createdAt: t.createdAt }));
  }

  /** Decrypts with the owner's viewer bundle only (no signing key). Syncs a fresh read-only wallet from the indexer. */
  async decryptForViewer(viewingKey: string, address: string): Promise<DecryptedTransfer[]> {
    const parts = decodeViewerBundle(viewingKey);
    if (!parts) return [];
    const { spr, client, env } = await this.ready();
    const addr = spr.ShieldedAddress.fromBytes(parts.a);
    if (addr.solanaAddress() !== address) return [];
    const keys = spr.LocalKeys.fromKeys({
      address: addr,
      viewingKeys: [spr.ViewingKey.fromBytes(parts.vk as any)],
      nullifierKey: spr.NullifierKey.fromSecret(parts.nk as any),
    }, client.proofService);
    try {
      const wallet = new spr.Wallet({ identity: addr });
      await spr.syncWallet({ client, wallet, keys });
      const bySig = new Map(this.store.log.map(l => [l.signature, l]));
      return spr.getPrivateTransactions(wallet)
        .filter(t => t.direction !== "selfTransfer")
        .map(t => {
          const l = bySig.get(t.id.signature);
          const dir = t.direction === "inbound" ? "in" : "out";
          return {
            signature: t.id.signature, direction: dir,
            from: l?.from ?? (dir === "out" ? address : "unknown"),
            to: l?.to ?? (dir === "in" ? address : "unknown"),
            encryptedAmount: l?.cipher ?? "", memo: l?.memo,
            createdAt: l?.createdAt ?? new Date(0).toISOString(),
            amount: this.fromBase(t.amount, env),
          } as DecryptedTransfer;
        });
    } finally { keys.destroy(); }
  }
}

/** Kept for callers of the earlier skeleton. Prefer createRing({ mode: "helius" }). */
export async function createHeliusRing(dataDir = process.env.RING_DATA_DIR ?? join(process.cwd(), "data")): Promise<Ring> {
  if (process.env.RING_MODE !== "helius") throw new Error("set HELIUS_API_KEY and RING_MODE=helius");
  return new HeliusRing(dataDir);
}
