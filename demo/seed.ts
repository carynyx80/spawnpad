// Spawnpad seed: fills a local marketplace with ~10 agents and 14 jobs in every lifecycle state.
// Run (API on :4100, verifier on :4200):  cd demo && npx tsx seed.ts   (or `npm run seed` at the repo root)
// Idempotent-ish: if the seed's marker agent already exists, it exits without changes.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  sealTo, openWith, toB64, hashTests,
  type SealedBidBody, type SealedBudget, type Job, type Bid, type Agent, type DataSpec, type CodeSpec,
} from "../packages/sdk/src/index.ts";

const API = (process.env.SPAWNPAD_API ?? "http://localhost:4100").replace(/\/$/, "");
const KEYS_FILE = new URL("./demo-keys.json", import.meta.url);
const MARKER = "Tern Systems";

// ---------- tiny HTTP client that always sends the acting agent's Bearer key ----------
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
async function call<T>(method: string, path: string, body?: unknown, apiKey?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data: any = text; try { data = text ? JSON.parse(text) : undefined; } catch { /* text */ }
  if (!res.ok) throw new HttpError(res.status, `${method} ${path} -> ${res.status}: ${data?.error ?? data?.message ?? text}`);
  return data as T;
}

type Seeded = Agent & { ownerViewingKey: string; apiKey: string };
const c = (n: number) => (s: string | number) => `\x1b[${n}m${s}\x1b[0m`;
const bold = c(1), dim = c(2), green = c(32), red = c(31), yellow = c(33), cyan = c(36);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const nowS = () => Math.floor(Date.now() / 1000);

const AGENTS: { name: string; wallet: string }[] = [
  { name: "Polaris Research", wallet: "OwnerPolaris" },
  { name: "Meridian Quant", wallet: "OwnerMeridian" },
  { name: "Halcyon Analytics", wallet: "OwnerHalcyon" },
  { name: MARKER, wallet: "OwnerTern" },
  { name: "Kestrel Data", wallet: "OwnerKestrel" },
  { name: "Forge Coder", wallet: "OwnerForge" },
  { name: "Vesper Scraper", wallet: "OwnerVesper" },
  { name: "Lumen QA", wallet: "OwnerLumen" },
  { name: "Orbit Labs", wallet: "OwnerOrbit" },
  { name: "Quarry Indexer", wallet: "OwnerQuarry" },
];
const pad = (w: string) => (w + "1".repeat(44)).slice(0, 44);

// ---------- job catalogue ----------
type Target = "open" | "awarded" | "funded" | "settled" | "refunded" | "cancelled";
interface DataJob { kind: "data_delivery"; spec: DataSpec; good: () => unknown[]; bad?: () => unknown[] }
interface CodeJob { kind: "code_tests"; entry: string; tests: { args: unknown[]; expected: unknown }[]; good: string; bad?: string }
interface Plan { title: string; description: string; buyer: string; budget: number; target: Target; deadlineH: number; bids: [string, number][]; job: DataJob | CodeJob }

const rows = (n: number, f: (i: number) => Record<string, unknown>) => Array.from({ length: n }, (_, i) => f(i));
const POOLS = ["SOL/USDC", "JUP/SOL", "BONK/SOL", "JTO/USDC", "PYTH/USDC", "WIF/SOL", "RAY/USDC", "mSOL/SOL"];

const PLANS: Plan[] = [
  // ---- open: collecting sealed bids ----
  { title: "Daily DEX swap volume, top Solana pools", description: "Rows of {pool, volume_usd, timestamp} for the last 24h. Fresher than 1 hour.", buyer: "Polaris Research", budget: 60, target: "open", deadlineH: 18,
    bids: [["Kestrel Data", 44], ["Vesper Scraper", 39], ["Quarry Indexer", 52]],
    job: { kind: "data_delivery", spec: { schema: { pool: "string", volume_usd: "number", timestamp: "number" }, minRows: 8, maxAgeSeconds: 3600 }, good: () => rows(8, (i) => ({ pool: POOLS[i], volume_usd: 1e6 * (i + 1), timestamp: nowS() - 60 })) } },
  { title: "Implement TWAP calculator passing hidden test suite", description: "Export twap(prices, window). Edge cases included.", buyer: "Meridian Quant", budget: 90, target: "open", deadlineH: 30,
    bids: [["Forge Coder", 70], ["Orbit Labs", 82]],
    job: { kind: "code_tests", entry: "twap", tests: [{ args: [[1, 2, 3, 4], 2], expected: 3.5 }, { args: [[5], 1], expected: 5 }], good: "module.exports.twap=(p,w)=>{const s=p.slice(-w);return s.reduce((a,b)=>a+b,0)/s.length}" } },
  { title: "Validator commission history, epochs 700 to 760", description: "Every active validator, commission per epoch. Schema enforced.", buyer: "Halcyon Analytics", budget: 120, target: "open", deadlineH: 48,
    bids: [["Quarry Indexer", 95], ["Kestrel Data", 101], ["Vesper Scraper", 88], ["Orbit Labs", 110]],
    job: { kind: "data_delivery", spec: { schema: { vote_account: "string", epoch: "number", commission: "number" }, minRows: 5 }, good: () => rows(5, (i) => ({ vote_account: `Vote${i}`, epoch: 700 + i, commission: 5 })) } },
  { title: "Parse Anchor IDL into TypeScript types", description: "Export idlToTs(idl). Tests run against real program IDLs.", buyer: MARKER, budget: 75, target: "open", deadlineH: 26,
    bids: [["Forge Coder", 64]],
    job: { kind: "code_tests", entry: "idlToTs", tests: [{ args: [{ name: "x" }], expected: "type X = {}" }], good: "module.exports.idlToTs=(i)=>`type ${i.name.toUpperCase()} = {}`" } },
  // ---- awarded: winner picked, waiting for escrow ----
  { title: "NFT floor prices for 40 collections, hourly", description: "{collection, floor_sol, timestamp}. Freshness under 15 minutes.", buyer: "Polaris Research", budget: 50, target: "awarded", deadlineH: 12,
    bids: [["Vesper Scraper", 34], ["Kestrel Data", 41]],
    job: { kind: "data_delivery", spec: { schema: { collection: "string", floor_sol: "number", timestamp: "number" }, minRows: 4, maxAgeSeconds: 900 }, good: () => rows(4, (i) => ({ collection: `col${i}`, floor_sol: 10 + i, timestamp: nowS() })) } },
  { title: "Priority-fee estimator for compute-unit budgets", description: "Export estimateFee(samples, percentile). Must pass hidden tests.", buyer: "Meridian Quant", budget: 45, target: "awarded", deadlineH: 20,
    bids: [["Orbit Labs", 30], ["Forge Coder", 38]],
    job: { kind: "code_tests", entry: "estimateFee", tests: [{ args: [[1, 2, 3, 4, 5], 50], expected: 3 }], good: "module.exports.estimateFee=(s,p)=>{const a=[...s].sort((x,y)=>x-y);return a[Math.floor((a.length-1)*p/100)]}" } },
  // ---- funded: escrow holds the encrypted payment ----
  { title: "Jito tip distribution, last 7 days", description: "{slot, tip_lamports, timestamp} rows, at least 6.", buyer: "Halcyon Analytics", budget: 40, target: "funded", deadlineH: 10,
    bids: [["Quarry Indexer", 26], ["Kestrel Data", 29]],
    job: { kind: "data_delivery", spec: { schema: { slot: "number", tip_lamports: "number", timestamp: "number" }, minRows: 6 }, good: () => rows(6, (i) => ({ slot: 3e8 + i, tip_lamports: 1e4 * i, timestamp: nowS() })) } },
  { title: "Fix flaky retry logic in RPC client", description: "Export withRetry(fn, n). Must pass 18 tests including jittered backoff.", buyer: MARKER, budget: 85, target: "funded", deadlineH: 14,
    bids: [["Lumen QA", 66], ["Forge Coder", 72]],
    job: { kind: "code_tests", entry: "withRetry", tests: [{ args: [3], expected: 3 }], good: "module.exports.withRetry=(n)=>n" } },
  // ---- settled: verifier passed, seller paid privately ----
  { title: "Orderbook depth snapshots for SOL perps", description: "{market, bid_depth, ask_depth, timestamp}, at least 5 rows, under 1 hour old.", buyer: "Polaris Research", budget: 70, target: "settled", deadlineH: 8,
    bids: [["Kestrel Data", 48], ["Vesper Scraper", 55]],
    job: { kind: "data_delivery", spec: { schema: { market: "string", bid_depth: "number", ask_depth: "number", timestamp: "number" }, minRows: 5, maxAgeSeconds: 3600 }, good: () => rows(5, (i) => ({ market: "SOL-PERP", bid_depth: 1e5 + i, ask_depth: 9e4 + i, timestamp: nowS() - 30 * i })) } },
  { title: "Lamports-to-SOL formatter with rounding rules", description: "Export formatSol(lamports). Hidden tests cover rounding and large values.", buyer: "Meridian Quant", budget: 30, target: "settled", deadlineH: 6,
    bids: [["Forge Coder", 18], ["Lumen QA", 22], ["Orbit Labs", 25]],
    job: { kind: "code_tests", entry: "formatSol", tests: [{ args: [1_000_000_000], expected: "1.000" }, { args: [1_234_567], expected: "0.001" }, { args: [0], expected: "0.000" }], good: "module.exports.formatSol=(l)=>(l/1e9).toFixed(3)" } },
  { title: "Token-2022 mint registry with transfer-fee flags", description: "{mint, symbol, has_transfer_fee} for at least 6 mints.", buyer: "Halcyon Analytics", budget: 55, target: "settled", deadlineH: 9,
    bids: [["Quarry Indexer", 37], ["Kestrel Data", 43]],
    job: { kind: "data_delivery", spec: { schema: { mint: "string", symbol: "string", has_transfer_fee: "boolean" }, minRows: 6 }, good: () => rows(6, (i) => ({ mint: `Mint${i}`, symbol: `TK${i}`, has_transfer_fee: i % 2 === 0 })) } },
  // ---- refunded: verifier failed, buyer refunded ----
  { title: "MEV bundle classifier", description: "Export classify(bundle) returning 'arb' | 'sandwich' | 'liquidation'.", buyer: "Polaris Research", budget: 95, target: "refunded", deadlineH: 7,
    bids: [["Orbit Labs", 80], ["Forge Coder", 88]],
    job: { kind: "code_tests", entry: "classify", tests: [{ args: [{ legs: 3 }], expected: "sandwich" }, { args: [{ legs: 2 }], expected: "arb" }], good: "module.exports.classify=(b)=>b.legs===3?'sandwich':'arb'", bad: "module.exports.classify=()=> 'arb'" } },
  { title: "Stake pool APY history, 90 days", description: "{pool, apy, timestamp}, at least 10 rows.", buyer: MARKER, budget: 35, target: "refunded", deadlineH: 5,
    bids: [["Vesper Scraper", 24]],
    job: { kind: "data_delivery", spec: { schema: { pool: "string", apy: "number", timestamp: "number" }, minRows: 10 }, good: () => rows(10, (i) => ({ pool: `p${i}`, apy: 7, timestamp: nowS() })), bad: () => rows(4, (i) => ({ pool: `p${i}`, apy: "7%", timestamp: nowS() })) } },
  // ---- cancelled by the buyer before award ----
  { title: "Compressed NFT ownership snapshot", description: "{asset_id, owner, timestamp} for a Bubblegum tree. Cancelled: scope changed.", buyer: "Meridian Quant", budget: 25, target: "cancelled", deadlineH: 24,
    bids: [["Quarry Indexer", 21]],
    job: { kind: "data_delivery", spec: { schema: { asset_id: "string", owner: "string", timestamp: "number" }, minRows: 3 }, good: () => [] } },
];

// ---------- helpers ----------
function mergeKeys(agents: Seeded[]) {
  let existing: any[] = [];
  if (existsSync(KEYS_FILE)) { try { existing = JSON.parse(readFileSync(KEYS_FILE, "utf8")); } catch { existing = []; } }
  const byId = new Map(existing.map((k) => [k.agentId, k]));
  for (const a of agents) byId.set(a.id, { name: a.name, agentId: a.id, shieldedAddress: a.shieldedAddress, ownerViewingKey: a.ownerViewingKey, apiKey: a.apiKey });
  writeFileSync(KEYS_FILE, JSON.stringify([...byId.values()], null, 2));
}

async function waitForApi() {
  for (let i = 0; i < 60; i++) {
    try { const h = await call<{ ok: boolean; verifier?: boolean }>("GET", "/health"); if (h.ok) return h; } catch { /* not up */ }
    if (i === 0) console.log(dim(`waiting for API at ${API} …`));
    await sleep(2000);
  }
  throw new Error(`API not reachable at ${API}`);
}

async function main() {
  console.log(bold(cyan("\n  ◎ SPAWNPAD seed")) + dim(`  ${API}\n`));
  const h = await waitForApi();
  if (h.verifier === false) throw new Error("verifier is down: start services/verifier first (settled/refunded jobs need it)");

  const existing = await call<Agent[]>("GET", "/agents");
  if (existing.some((a) => a.name === MARKER)) {
    console.log(yellow(`  "${MARKER}" already exists, so this marketplace is already seeded. Nothing to do.`));
    return;
  }

  // 1. agents
  const agents = new Map<string, Seeded>();
  for (const a of AGENTS) {
    const r = await call<Seeded>("POST", "/agents", { name: a.name, ownerWallet: pad(a.wallet) });
    if (!r.apiKey) throw new Error("API did not return an apiKey: the server is not on the v2 auth contract yet.");
    agents.set(a.name, r);
    console.log(`  ${green("+")} agent ${a.name.padEnd(18)} ${dim(r.id)}`);
  }
  mergeKeys([...agents.values()]);
  console.log(dim(`  keys merged into demo/demo-keys.json`));
  const A = (n: string) => { const a = agents.get(n); if (!a) throw new Error(`unknown agent ${n}`); return a; };

  // 2. jobs
  const tally: Record<string, number> = {};
  for (const p of PLANS) {
    const buyer = A(p.buyer);
    let spec: DataSpec | CodeSpec, tests: string | undefined;
    if (p.job.kind === "code_tests") {
      tests = toB64(JSON.stringify(p.job.tests));
      spec = { language: "javascript", entry: p.job.entry, testsHash: hashTests(tests) };
    } else spec = p.job.spec;
    const job = await call<Job>("POST", "/jobs", {
      buyerAgentId: buyer.id, title: p.title, description: p.description, kind: p.job.kind, spec, tests,
      encryptedBudget: sealTo(buyer.viewingPubKey, { maxPrice: p.budget, asset: "USDC" } satisfies SealedBudget),
      deadline: hours(p.deadlineH),
    }, buyer.apiKey);

    for (const [sellerName, price] of p.bids) {
      const s = A(sellerName);
      await call<Bid>("POST", `/jobs/${job.id}/bids`, { sellerAgentId: s.id, sealedBid: sealTo(buyer.viewingPubKey, { price, note: `${sellerName} can deliver` } satisfies SealedBidBody) }, s.apiKey);
    }

    let final: Job = job;
    if (p.target === "cancelled") {
      final = await call<Job>("POST", `/jobs/${job.id}/cancel`, {}, buyer.apiKey);
    } else if (p.target !== "open") {
      // buyer decrypts bids locally and awards the cheapest within budget
      const full = await call<Job & { bids: Bid[] }>("GET", `/jobs/${job.id}`);
      const opened = full.bids.map((b) => ({ b, price: openWith<SealedBidBody>(buyer.ownerViewingKey, b.sealedBid).price })).sort((x, y) => x.price - y.price);
      const win = opened.find((o) => o.price <= p.budget);
      if (!win) throw new Error(`no bid within budget for ${p.title}`);
      final = await call<Job>("POST", `/jobs/${job.id}/award`, { bidId: win.b.id }, buyer.apiKey);
      if (p.target !== "awarded") {
        final = await call<Job>("POST", `/jobs/${job.id}/fund`, { amount: win.price }, buyer.apiKey);
        if (p.target === "settled" || p.target === "refunded") {
          const seller = [...agents.values()].find((a) => a.id === win.b.sellerAgentId)!;
          const content = p.job.kind === "code_tests"
            ? (p.target === "refunded" ? p.job.bad ?? "module.exports = {}" : p.job.good)
            : JSON.stringify(p.target === "refunded" ? (p.job.bad?.() ?? []) : p.job.good());
          final = await call<Job>("POST", `/jobs/${job.id}/deliver`, { sellerAgentId: seller.id, payloadForVerifier: toB64(content), payloadForBuyer: sealTo(buyer.viewingPubKey, { content }) }, seller.apiKey);
        }
      }
    }
    const ok = final.status === p.target;
    tally[final.status] = (tally[final.status] ?? 0) + 1;
    console.log(`  ${ok ? green("✓") : red("✗")} ${final.status.padEnd(9)} ${p.title} ${dim(`(${p.bids.length} sealed bids)`)}`);
    if (!ok) throw new Error(`expected ${p.target}, got ${final.status} for "${p.title}"`);
  }

  const s = await call<Record<string, unknown>>("GET", "/stats");
  console.log("\n  " + Object.entries(tally).map(([k, v]) => `${k} ${bold(v)}`).join(dim(" · ")));
  console.log(dim(`  marketplace now: jobs ${s.jobs} · settled ${s.settled} · agents ${s.agents} · volume hidden\n`));
}

main().catch((e) => { console.error(red(`\n  seed failed: ${e.message}\n`)); process.exit(1); });
