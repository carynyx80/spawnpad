// Devnet smoke test for the Helius ring: create -> deposit -> transfer -> balance -> viewer decrypt.
// Run: HELIUS_API_KEY=... SOLANA_PAYER_SECRET='[..64 bytes..]' npx tsx src/helius-smoke.ts
// Without the env it explains what is needed and exits 0.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HeliusRing, heliusEnv } from "./helius.ts";

const { env, missing } = heliusEnv();
if (!env) {
  console.log(`helius smoke: skipped. Set these to run on devnet:
  HELIUS_API_KEY        your Helius API key (dashboard.helius.dev)
  SOLANA_PAYER_SECRET   64-byte fee-payer keypair (solana-keygen JSON array or base58), funded with devnet SOL
optional:
  HELIUS_CLUSTER        devnet (default) | mainnet
  RING_ASSET_MINT       SPL mint to use instead of SOL (+ RING_SPL_SOURCE_ACCOUNT = payer's token account)
  RING_UNIT_BASE        base units per 1.0 amount (default 1000000)
missing now: ${missing.join(", ")}`);
  process.exit(0);
}

const dir = process.env.RING_DATA_DIR ?? mkdtempSync(join(tmpdir(), "spawnpad-helius-"));
const ring = new HeliusRing(dir);
const t0 = Date.now();
const step = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

step(`cluster=${env.cluster} asset=${env.assetMint ?? "SOL"} unitBase=${env.unitBase} dataDir=${dir}`);
const a = await ring.createShieldedWallet("smoke-a"); step(`created A ${a.address}`);
const b = await ring.createShieldedWallet("smoke-b"); step(`created B ${b.address}`);
const dep = await ring.deposit(a.keyId, 2); step(`deposit 2 -> A  sig=${dep.signature}`);
step(`A balance ${await ring.balance(a.keyId)}`);
const tx = await ring.transfer({ fromKeyId: a.keyId, to: b.address, amount: 0.5, memo: "smoke" }); step(`transfer 0.5 A -> B  sig=${tx.signature}`);
step(`A balance ${await ring.balance(a.keyId)}  B balance ${await ring.balance(b.keyId)}`);
try { await ring.transfer({ fromKeyId: b.keyId, to: a.address, amount: 999 }); step("UNEXPECTED: overdraft accepted"); process.exitCode = 1; }
catch (e) { step(`overdraft rejected: ${(e as Error).message}`); }
const view = await ring.decryptForViewer(b.viewingKey, b.address);
step(`B viewer decrypts ${view.length} row(s): ${view.map(v => `${v.direction} ${v.amount}`).join(", ")}`);
const wrong = await ring.decryptForViewer(a.viewingKey, b.address);
step(`A's key on B's address -> ${wrong.length} rows (expect 0)`);
console.log("helius smoke: done");
