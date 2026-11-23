// Spawnpad end-to-end demo: two private jobs between AI agents, settled through a Privacy Ring escrow.
// Run: (API on :4100, verifier on :4200)  cd demo && npx tsx run.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SpawnpadClient, sealTo, openWith, toB64, hashTests, verifyAttestation,
  type RegisteredAgent, type SealedBidBody, type SealedBudget, type Job, type DataSpec, type CodeSpec,
} from "../packages/sdk/src/index.ts";
import { createRing } from "../packages/ring/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.SPAWNPAD_API ?? "http://localhost:4100";
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(here, "../data");
const rw = new SpawnpadClient({ baseUrl: API });

// ---------- terminal styling ----------
const c = (n: number) => (s: string | number) => `\x1b[${n}m${s}\x1b[0m`;
const bold = c(1), dim = c(2), red = c(31), green = c(32), yellow = c(33), blue = c(34), magenta = c(35), cyan = c(36);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PACE = Number(process.env.PACE ?? 250);
async function step(title: string) { await sleep(PACE); console.log("\n" + bold(cyan("▸ " + title))); }
const say = (who: string, msg: string) => console.log(`  ${bold(who.padEnd(10))} ${msg}`);
const short = (s?: string, n = 10) => (s ? (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-4)}` : s) : "-");

async function waitForApi() {
  for (let i = 0; i < 60; i++) {
    try { if ((await rw.health()).ok) return; } catch { /* not up */ }
    if (i === 0) console.log(dim(`waiting for API at ${API} …`));
    await sleep(2000);
  }
  throw new Error(`API not reachable at ${API}`);
}

async function main() {
  console.log(bold(magenta("\n  ◎ SPAWNPAD")) + dim("  private job market for AI agents · Helius Privacy Rings\n"));
  await waitForApi();

  // ---------- 1. agents ----------
  await step("1. Three agents join the market (each gets a private ring wallet)");
  // The first registerAgent() makes `rw` act as the buyer; sellers act through rw.as(seller.apiKey).
  const buyer = await rw.registerAgent({ name: "Atlas Research", ownerWallet: "OwnerAtlas1111111111111111111111111111111111" });
  const sellerA = await rw.registerAgent({ name: "Scrapewell Data", ownerWallet: "OwnerScrape111111111111111111111111111111111" });
  const sellerB = await rw.registerAgent({ name: "Quickcode Labs", ownerWallet: "OwnerQuick1111111111111111111111111111111111" });
  // Save owner viewing keys locally so you can paste one into the dashboard's Owner audit page.
  {
    const { writeFileSync } = await import("node:fs");
    const keys = [buyer, sellerA, sellerB].map((a: any) => ({ name: a.name, agentId: a.id, shieldedAddress: a.shieldedAddress, ownerViewingKey: a.ownerViewingKey, apiKey: a.apiKey }));
    writeFileSync(new URL("./demo-keys.json", import.meta.url), JSON.stringify(keys, null, 2));
  }
  for (const a of [buyer, sellerA, sellerB])
    say(a.name, `${dim("agent")} ${a.id}  ${dim("ring address")} ${short(a.shieldedAddress)}  ${dim("owner holds viewing key")} 🔑`);

  // ---------- 2. jobs ----------
  await step("2. atlas-research posts two jobs. Budgets are sealed: only atlas can read them");
  const dataSpec: DataSpec = { schema: { symbol: "string", price: "number", timestamp: "number" }, minRows: 3, maxAgeSeconds: 3600 };
  const dataJob = await rw.postJob({
    buyerAgentId: buyer.id, kind: "data_delivery",
    title: "Hourly SOL/USDC quotes from 3 venues",
    description: "JSON array of {symbol, price, timestamp}, at least 3 rows, under 1 hour old.",
    spec: dataSpec,
    encryptedBudget: sealTo(buyer.viewingPubKey, { maxPrice: 40, asset: "USDC" } satisfies SealedBudget),
    deadline: new Date(Date.now() + 3600_000).toISOString(),
  });
  const tests = [
    { args: [[3, 1, 2]], expected: [1, 2, 3] },
    { args: [[5, -1, 5, 0]], expected: [-1, 0, 5, 5] },
    { args: [[]], expected: [] },
    { args: [[10, 9, 1]], expected: [1, 9, 10] },
  ];
  const testsB64 = toB64(JSON.stringify(tests));
  const codeSpec: CodeSpec = { language: "javascript", entry: "sortNums", testsHash: hashTests(testsB64) };
  const codeJob = await rw.postJob({
    buyerAgentId: buyer.id, kind: "code_tests",
    title: "sortNums(arr): numeric ascending sort",
    description: "Export sortNums. Must pass a hidden test suite.",
    spec: codeSpec, tests: testsB64,
    encryptedBudget: sealTo(buyer.viewingPubKey, { maxPrice: 25, asset: "USDC" } satisfies SealedBudget),
    deadline: new Date(Date.now() + 3600_000).toISOString(),
  });
  say("atlas", `${dataJob.id}  ${dataJob.title}`);
  say("atlas", `${codeJob.id}  ${codeJob.title}  ${dim("(hidden tests, hash " + short(codeSpec.testsHash, 8) + ")")}`);
  say("market", `stored budget: ${yellow(short(dataJob.encryptedBudget, 18))}  ${dim("← ciphertext, the market can't read it")}`);

  // ---------- 3. sealed bids ----------
  await step("3. Sellers submit sealed bids, encrypted to atlas's viewing key");
  const bidPlan: [RegisteredAgent, Job, number][] = [
    [sellerA, dataJob, 32], [sellerB, dataJob, 36],
    [sellerA, codeJob, 22], [sellerB, codeJob, 18],
  ];
  for (const [s, j, price] of bidPlan) {
    const b = await rw.as(s.apiKey).bid(j.id, s.id, sealTo(buyer.viewingPubKey, { price, note: `${s.name} can deliver` } satisfies SealedBidBody));
    say(s.name, `bid on ${j.id}: ${yellow(short(b.sealedBid, 14))}  ${dim("(I bid " + price + " USDC; nobody else can see that)")}`);
  }

  // ---------- 4. award ----------
  await step("4. atlas opens the bids locally and awards the cheapest");
  const awarded: Record<string, { price: number; seller: string }> = {};
  for (const j of [dataJob, codeJob]) {
    const full = await rw.getJob(j.id);
    const opened = full.bids.map((b) => ({ b, body: openWith<SealedBidBody>(buyer.ownerViewingKey, b.sealedBid) }));
    const budget = openWith<SealedBudget>(buyer.ownerViewingKey, full.encryptedBudget);
    opened.sort((x, y) => x.body.price - y.body.price);
    const win = opened.find((o) => o.body.price <= budget.maxPrice);
    if (!win) throw new Error(`no bid within budget for ${j.id}`);
    for (const o of opened) say("atlas", `${dim("decrypted")} ${o.b.sellerAgentId} → ${o.body.price} USDC ${o === win ? green("✓ winner") : ""}`);
    await rw.award(j.id, win.b.id);
    awarded[j.id] = { price: win.body.price, seller: win.b.sellerAgentId };
  }

  // ---------- 5. fund ----------
  await step("5. atlas funds escrow with private ring transfers");
  for (const j of [dataJob, codeJob]) {
    const funded = await rw.fund(j.id, awarded[j.id].price);
    say("atlas", `${j.id} ${green(funded.status)}  ${dim("escrow tx")} ${short(funded.escrowTx)}`);
  }

  // ---------- 6. deliver ----------
  await step("6. Sellers deliver. The verifier checks the work before money moves");
  const nowS = Math.floor(Date.now() / 1000);
  const rows = [
    { symbol: "SOL/USDC", price: 142.31, timestamp: nowS - 60 },
    { symbol: "SOL/USDC", price: 142.29, timestamp: nowS - 45 },
    { symbol: "SOL/USDC", price: 142.35, timestamp: nowS - 30 },
  ];
  const dataContent = JSON.stringify(rows);
  const dataDone = await rw.as(sellerA.apiKey).deliver(dataJob.id, sellerA.id, toB64(dataContent), sealTo(buyer.viewingPubKey, { content: dataContent }));
  printSettlement(dataDone);

  // The code winner ships a lexicographic sort: small cases pass, but [10,9,1] -> [1,10,9] fails the hidden tests.
  const badCode = "module.exports.sortNums = (a) => [...a].sort();";
  const codeSeller = awarded[codeJob.id].seller === sellerB.id ? sellerB : sellerA;
  const codeDone = await rw.as(codeSeller.apiKey).deliver(codeJob.id, codeSeller.id, toB64(badCode), sealTo(buyer.viewingPubKey, { content: badCode }));
  printSettlement(codeDone);

  // ---------- 7. buyer receives deliverable ----------
  await step("7. atlas collects the data it paid for");
  try {
    const d = await rw.getDeliverable(dataJob.id, buyer.id);
    const got = openWith<{ content: string }>(buyer.ownerViewingKey, d.payloadForBuyer);
    say("atlas", `${green("decrypted deliverable")}: ${JSON.parse(got.content).length} rows, first = ${dim(JSON.stringify(rows[0]))}`);
  } catch (e) { say("atlas", red(`could not fetch deliverable: ${(e as Error).message}`)); }
  try {
    await rw.getDeliverable(codeJob.id, buyer.id);
    say("atlas", red("unexpected: refunded job released a deliverable"));
  } catch { say("atlas", dim("code job was refunded, so no deliverable is released (and atlas keeps its money)")); }

  // ---------- 8. public vs owner view ----------
  await step("8. What a public block explorer sees");
  const pub = await rw.transfers(buyer.shieldedAddress);
  for (const t of pub) console.log(`  ${dim(short(t.signature, 8))}  ${short(t.from, 6)} → ${short(t.to, 6)}  amount: ${yellow(short(t.encryptedAmount, 14))}`);
  console.log(dim("  Addresses are visible (default ring), but asset and amount are ciphertext. Every agent only ever trades with the escrow."));

  await step("9. What atlas's OWNER sees with the viewing key");
  const ring = createRing({ mode: "mock", dataDir: DATA_DIR });
  for (const [label, agent] of [["atlas (buyer)", buyer], ["scrapewell", sellerA], ["quickcode", sellerB]] as const) {
    const mine = await ring.decryptForViewer(agent.ownerViewingKey, agent.shieldedAddress);
    console.log("  " + bold(label));
    let net = 0;
    for (const t of mine) {
      const sign = t.direction === "in" ? "+" : "-";
      net += t.direction === "in" ? t.amount : -t.amount;
      console.log(`    ${t.direction === "in" ? green(sign + t.amount.toFixed(2)) : red(sign + t.amount.toFixed(2))} USDC  ${dim(t.memo ?? "")}  ${dim(short(t.signature, 6))}`);
    }
    console.log(`    ${dim("net")} ${bold(net.toFixed(2))} USDC  ${dim("balance from ring")} ${bold((await safeBalance(agent)).toString())}`);
  }

  const s = await rw.stats().catch(() => null);
  console.log("\n" + bold(magenta("  ◎ done")) + dim(s ? `  jobs ${s.jobs} · settled ${s.settled} · agents ${s.agents} · volume hidden: ${s.volumeHidden}` : ""));
  console.log(dim("  The market matched, escrowed and settled without ever learning a price.\n"));
}

async function safeBalance(agent: RegisteredAgent) {
  // The API keeps spend keys custodially in mock mode; balance is derived from decrypted transfers instead.
  const ring = createRing({ mode: "mock", dataDir: DATA_DIR });
  const txs = await ring.decryptForViewer(agent.ownerViewingKey, agent.shieldedAddress);
  return Number(txs.reduce((n, t) => n + (t.direction === "in" ? t.amount : -t.amount), 0).toFixed(2));
}

function printSettlement(j: Job) {
  const att = j.attestation;
  const ok = j.status === "settled";
  say("verifier", `${j.id} ${ok ? green("PASS → settled") : red("FAIL → " + j.status)}`);
  if (att) {
    for (const line of att.report.split("\n").filter(Boolean)) console.log(`             ${dim(line)}`);
    say("", `${dim("attestation signed by")} ${short(att.verifierPubKey, 8)} ${verifyAttestation(att as never) ? green("signature ✓") : yellow("signature not checked locally")}`);
  }
  if (j.settlementTx) say("escrow", `${ok ? "paid seller (minus 1.5% fee)" : "refunded buyer"}  ${dim("tx")} ${short(j.settlementTx)}`);
  if (j.feeTx) say("escrow", `fee → Spawnpad treasury  ${dim("tx")} ${short(j.feeTx)}`);
}

main().catch((e) => { console.error(red("\n✗ demo failed: " + (e?.message ?? e))); process.exit(1); });
