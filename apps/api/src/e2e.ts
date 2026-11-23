// Integration test against a running API (default http://localhost:4100) + verifier.
import { createHash } from "node:crypto";
const API = process.env.API_URL ?? "http://localhost:4100";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
let failures = 0;
function check(cond: unknown, msg: string) { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) failures++; }

async function call(method: string, path: string, body?: unknown, key?: string) {
  const headers: Record<string, string> = {};
  if (body) headers["content-type"] = "application/json";
  if (key) headers.authorization = `Bearer ${key}`;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
const ok = async (method: string, path: string, body?: unknown, key?: string) => {
  const r = await call(method, path, body, key);
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};
const deadline = () => new Date(Date.now() + 10 * 60_000).toISOString();

const health = await ok("GET", "/health");
check(health.ok, `health ok (ring=${health.ring}, fallback=${health.fallbackRing}, verifier=${health.verifier})`);

const buyer = await ok("POST", "/agents", { name: "Buyer Agent", ownerWallet: "OwnerBuyer1111" });
const seller = await ok("POST", "/agents", { name: "Seller Agent", ownerWallet: "OwnerSeller111" });
check(buyer.ownerViewingKey && buyer.shieldedAddress, "agent create returns ownerViewingKey once");
check(/^sk_agt_/.test(buyer.apiKey ?? ""), "agent create returns apiKey once");
const B = buyer.apiKey as string, S = seller.apiKey as string;
const fetched = await ok("GET", `/agents/${buyer.id}`);
check(!("ownerViewingKey" in fetched) && !("keyId" in fetched) && !("apiKey" in fetched) && !("apiKeyHash" in fetched), "GET /agents/:id hides viewing key, key id and api key");
check(fetched.stats && fetched.limits, "agent response includes stats and limits");

// ---- Happy path: data delivery ----
const job = await ok("POST", "/jobs", {
  buyerAgentId: buyer.id, title: "Daily SOL price rows", description: "e2e", kind: "data_delivery",
  spec: { schema: { symbol: "string", price: "number" }, minRows: 3 }, encryptedBudget: "sealed:budget", deadline: deadline(),
}, B);
check(job.status === "open" && /^[0-9a-f]{64}$/.test(job.specHash), "job created open with specHash");
check((await call("POST", `/jobs/${job.id}/bids`, { sellerAgentId: buyer.id, sealedBid: "x" }, B)).status === 400, "buyer cannot bid own job");
const bid = await ok("POST", `/jobs/${job.id}/bids`, { sellerAgentId: seller.id, sealedBid: "sealed:100" }, S);
check((await call("POST", `/jobs/${job.id}/fund`, { amount: 100 }, B)).status === 409, "fund before award -> 409");
await ok("POST", `/jobs/${job.id}/award`, { bidId: bid.id }, B);
const funded = await ok("POST", `/jobs/${job.id}/fund`, { amount: 100 }, B);
check(funded.status === "funded" && funded.escrowTx, "job funded via ring transfer");
check((await call("GET", `/jobs/${job.id}/deliverable`, undefined, B)).status === 409, "deliverable locked before settlement");
const rows = [{ symbol: "SOL", price: 241.1 }, { symbol: "SOL", price: 242.3 }, { symbol: "SOL", price: 240.9 }];
const settled = await ok("POST", `/jobs/${job.id}/deliver`, { sellerAgentId: seller.id, payloadForVerifier: b64(JSON.stringify(rows)), payloadForBuyer: "enc:rows" }, S);
check(settled.status === "settled" && settled.attestation?.passed && settled.settlementTx && settled.feeTx, "data job settled with attestation, payout + fee txs");
const del = await ok("GET", `/jobs/${job.id}/deliverable`, undefined, B);
check(del.payloadForBuyer === "enc:rows", "buyer gets deliverable after settlement");
check((await call("GET", `/jobs/${job.id}/deliverable`, undefined, S)).status === 403, "non-buyer denied deliverable");
const pub = await ok("GET", `/ring/transfers?address=${seller.shieldedAddress}`);
check(Array.isArray(pub) && pub.length > 0 && pub.every((t: any) => !("amount" in t) && t.encryptedAmount), "public transfer view has no plaintext amounts");

// Owner audit: open seller envelopes client-side with the viewing key returned at agent creation
{
  const nacl = (await import("../../../packages/ring/node_modules/tweetnacl/nacl-fast.js")).default;
  const d = (x: string) => Uint8Array.from(Buffer.from(x, "base64"));
  const envs = await ok("GET", `/ring/envelopes?address=${seller.shieldedAddress}`);
  const amounts = envs.map((e: any) => {
    const p = nacl.box.open(d(e.envelope.box), d(e.envelope.nonce), d(e.envelope.ephemeralPubKey), d(seller.ownerViewingKey));
    return p ? JSON.parse(Buffer.from(p).toString("utf8")).amount : null;
  });
  check(amounts.includes(1000) && amounts.includes(98.5), `seller owner decrypts envelopes client-side: ${JSON.stringify(amounts)}`);
  const wrong = envs.every((e: any) => nacl.box.open(d(e.envelope.box), d(e.envelope.nonce), d(e.envelope.ephemeralPubKey), d(buyer.ownerViewingKey)) === null);
  check(wrong, "buyer's viewing key cannot open seller envelopes");
  check((await call("GET", "/ring/envelopes")).status === 400, "envelopes without address -> 400");
}

// ---- Code job happy path ----
const tests = JSON.stringify([{ args: [2, 3], expected: 5 }, { args: [-1, 1], expected: 0 }]);
const cjob = await ok("POST", "/jobs", {
  buyerAgentId: buyer.id, title: "Write add()", kind: "code_tests",
  spec: { language: "javascript", entry: "add", testsHash: sha(tests) }, encryptedBudget: "sealed", deadline: deadline(), tests: b64(tests),
}, B);
check((await call("POST", "/jobs", { buyerAgentId: buyer.id, title: "bad", kind: "code_tests", spec: { language: "javascript", entry: "add", testsHash: "0".repeat(64) }, encryptedBudget: "s", deadline: deadline(), tests: b64(tests) }, B)).status === 400, "testsHash mismatch rejected");
const cbid = await ok("POST", `/jobs/${cjob.id}/bids`, { sellerAgentId: seller.id, sealedBid: "sealed:50" }, S);
await ok("POST", `/jobs/${cjob.id}/award`, { bidId: cbid.id }, B);
await ok("POST", `/jobs/${cjob.id}/fund`, { amount: 50 }, B);
const csettled = await ok("POST", `/jobs/${cjob.id}/deliver`, { sellerAgentId: seller.id, payloadForVerifier: b64("module.exports.add = (a, b) => a + b;"), payloadForBuyer: "enc:code" }, S);
check(csettled.status === "settled", "code job settled when tests pass");

// ---- Refund path: failing verification ----
const rjob = await ok("POST", "/jobs", {
  buyerAgentId: buyer.id, title: "Rows that will fail", kind: "data_delivery",
  spec: { schema: { symbol: "string", price: "number" }, minRows: 5 }, encryptedBudget: "sealed", deadline: deadline(),
}, B);
const rbid = await ok("POST", `/jobs/${rjob.id}/bids`, { sellerAgentId: seller.id, sealedBid: "sealed:80" }, S);
await ok("POST", `/jobs/${rjob.id}/award`, { bidId: rbid.id }, B);
await ok("POST", `/jobs/${rjob.id}/fund`, { amount: 80 }, B);
check((await call("POST", `/jobs/${rjob.id}/deliver`, { sellerAgentId: buyer.id, payloadForVerifier: b64("[]"), payloadForBuyer: "x" }, B)).status === 403, "wrong seller cannot deliver");
const refunded = await ok("POST", `/jobs/${rjob.id}/deliver`, { sellerAgentId: seller.id, payloadForVerifier: b64(JSON.stringify([{ symbol: "SOL", price: "oops" }])), payloadForBuyer: "x" }, S);
check(refunded.status === "refunded" && refunded.attestation?.passed === false && refunded.settlementTx, "failed verification refunds buyer");
check((await call("POST", `/jobs/${rjob.id}/deliver`, { sellerAgentId: seller.id, payloadForVerifier: b64("[]"), payloadForBuyer: "x" }, S)).status === 409, "re-deliver after refund -> 409");

check((await call("GET", "/jobs/job_nope")).status === 404, "unknown job -> 404");

// ---- v2: auth ----
{
  const body = { buyerAgentId: buyer.id, title: "auth test", kind: "data_delivery", spec: { schema: { a: "string" }, minRows: 1 }, encryptedBudget: "s", deadline: deadline() };
  check((await call("POST", "/jobs", body)).status === 401, "post job without key -> 401");
  check((await call("POST", "/jobs", body, "sk_agt_bogus")).status === 401, "post job with unknown key -> 401");
  check((await call("POST", "/jobs", body, S)).status === 403, "post job with another agent's key -> 403");
  const aj = await ok("POST", "/jobs", body, B);
  check((await call("POST", `/jobs/${aj.id}/bids`, { sellerAgentId: seller.id, sealedBid: "x" })).status === 401, "bid without key -> 401");
  check((await call("POST", `/jobs/${aj.id}/bids`, { sellerAgentId: seller.id, sealedBid: "x" }, B)).status === 403, "bid with buyer's key for seller -> 403");
  const ab = await ok("POST", `/jobs/${aj.id}/bids`, { sellerAgentId: seller.id, sealedBid: "x" }, S);
  check((await call("POST", `/jobs/${aj.id}/award`, { bidId: ab.id }, S)).status === 403, "seller cannot award -> 403");
  check((await call("POST", `/jobs/${aj.id}/cancel`, {}, S)).status === 403, "seller cannot cancel -> 403");
  check((await call("GET", `/jobs/${job.id}/deliverable`)).status === 401, "deliverable without key -> 401");
  // filters + my bids
  const mine = await ok("GET", `/agents/${seller.id}/bids`);
  check(Array.isArray(mine) && mine.length >= 4 && mine.every((x: any) => x.sellerAgentId === seller.id && x.jobTitle && x.jobStatus), "GET /agents/:id/bids lists seller's bids with job title + status");
  const byBuyer = await ok("GET", `/jobs?buyerAgentId=${buyer.id}`);
  check(byBuyer.length >= 4 && byBuyer.every((j: any) => j.buyerAgentId === buyer.id), "GET /jobs?buyerAgentId filters");
  const bySeller = await ok("GET", `/jobs?sellerAgentId=${seller.id}&status=settled`);
  check(bySeller.length === 2 && bySeller.every((j: any) => j.status === "settled"), "GET /jobs?sellerAgentId&status filters awarded seller");
  // cancel
  const cancelled = await ok("POST", `/jobs/${aj.id}/cancel`, {}, B);
  check(cancelled.status === "cancelled", "buyer cancels open job");
  check((await call("POST", `/jobs/${aj.id}/cancel`, {}, B)).status === 409, "cancel twice -> 409");
  check((await call("POST", `/jobs/${job.id}/cancel`, {}, B)).status === 409, "cannot cancel settled job -> 409");
}

// ---- v2: spending limits ----
{
  check((await call("PUT", `/agents/${buyer.id}/limits`, { maxPerJob: 20 })).status === 401, "set limits without key -> 401");
  check((await call("PUT", `/agents/${buyer.id}/limits`, { maxPerJob: 20 }, S)).status === 403, "set limits with other key -> 403");
  const lim = await ok("PUT", `/agents/${buyer.id}/limits`, { maxPerJob: 20, maxPerDay: 300 }, B);
  check(lim.limits?.maxPerJob === 20 && lim.limits?.maxPerDay === 300, "limits saved");
  const mk = async () => {
    const lj = await ok("POST", "/jobs", { buyerAgentId: buyer.id, title: "limit test", kind: "data_delivery", spec: { schema: { a: "string" }, minRows: 1 }, encryptedBudget: "s", deadline: deadline() }, B);
    const lb = await ok("POST", `/jobs/${lj.id}/bids`, { sellerAgentId: seller.id, sealedBid: "x" }, S);
    await ok("POST", `/jobs/${lj.id}/award`, { bidId: lb.id }, B);
    return lj;
  };
  const l1 = await mk();
  const over = await call("POST", `/jobs/${l1.id}/fund`, { amount: 25 }, B);
  check(over.status === 422 && /spending limit/.test(over.json.error), "fund above maxPerJob -> 422");
  check((await ok("GET", `/jobs/${l1.id}`)).status === "awarded", "job stays awarded after limit rejection");
  // already escrowed today: 100 + 50 + 80 = 230; with maxPerDay 260 another 20 (250) is ok and the next 20 (270) is rejected
  await ok("PUT", `/agents/${buyer.id}/limits`, { maxPerJob: 20, maxPerDay: 260 }, B);
  check((await call("POST", `/jobs/${l1.id}/fund`, { amount: 20 }, B)).status === 200, "fund within limits ok (250 <= 260)");
  const l2 = await mk();
  const dayOver = await call("POST", `/jobs/${l2.id}/fund`, { amount: 20 }, B);
  check(dayOver.status === 422 && /maxPerDay/.test(dayOver.json.error), "fund above maxPerDay -> 422");
  await ok("PUT", `/agents/${buyer.id}/limits`, { maxPerJob: null, maxPerDay: null }, B);
  check((await call("POST", `/jobs/${l2.id}/fund`, { amount: 20 }, B)).status === 200, "clearing limits allows funding");
}
// ---- wallet balances + owner signatures ----
{
  check((await call("GET", "/wallet/not-a-wallet")).status === 400, "wallet balances with invalid address -> 400");
  const wb = await call("GET", "/wallet/4mSd9TdP86nnJiZb8SehHcU3bFMkhq64uuFtomsQFPUe");
  check(wb.status === 200 || wb.status === 502, `wallet balances with valid address -> ${wb.status} (200, or 502 if RPC unreachable)`);
  const { generateKeyPairSync, sign } = await import("node:crypto");
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const b58 = (buf: Buffer) => { let n = BigInt("0x" + (buf.toString("hex") || "0")); let out = ""; while (n > 0n) { out = A[Number(n % 58n)] + out; n /= 58n; } for (const x of buf) { if (x === 0) out = "1" + out; else break; } return out; };
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const owner = b58(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
  const name = "Signed Owner Agent";
  const msg = `Spawnpad: register agent "${name}" for owner ${owner} at ${new Date().toISOString()}`;
  const sig = sign(null, Buffer.from(msg), privateKey).toString("base64");
  const signed = await call("POST", "/agents", { name, ownerWallet: owner, ownerMessage: msg, ownerSignature: sig });
  check(signed.status === 201 && signed.json?.ownerVerified === true, "signed registration -> ownerVerified true");
  const tampered = await call("POST", "/agents", { name: "Other Name", ownerWallet: owner, ownerMessage: msg, ownerSignature: sig });
  check(tampered.status === 400, "signature for a different name -> 400");
  const badSig = await call("POST", "/agents", { name, ownerWallet: owner, ownerMessage: msg + " ", ownerSignature: sig });
  check(badSig.status === 400, "tampered message -> 400");
  const old = `Spawnpad: register agent "${name}" for owner ${owner} at ${new Date(Date.now() - 11 * 60_000).toISOString()}`;
  const stale = await call("POST", "/agents", { name, ownerWallet: owner, ownerMessage: old, ownerSignature: sign(null, Buffer.from(old), privateKey).toString("base64") });
  check(stale.status === 400, "signature older than 10 minutes -> 400");
  const unsigned = await call("POST", "/agents", { name: "Unsigned Owner Agent", ownerWallet: owner });
  check(unsigned.status === 201 && unsigned.json?.ownerVerified === false, "unsigned registration -> ownerVerified false");
}
// ---- balance + withdraw ----
{
  check((await call("GET", `/agents/${seller.id}/balance`)).status === 401, "balance without key -> 401");
  check((await call("GET", `/agents/${seller.id}/balance`, undefined, B)).status === 403, "balance with other agent's key -> 403");
  const before = (await ok("GET", `/agents/${seller.id}/balance`, undefined, S)).balance as number;
  check(before > 0, `seller balance readable (${before})`);
  const dest = "4mSd9TdP86nnJiZb8SehHcU3bFMkhq64uuFtomsQFPUe";
  check((await call("POST", `/agents/${seller.id}/withdraw`, { to: "not-an-address", amount: 1 }, S)).status === 400, "withdraw to invalid address -> 400");
  check((await call("POST", `/agents/${seller.id}/withdraw`, { to: dest, amount: before + 1 }, S)).status === 402, "withdraw more than balance -> 402");
  check((await call("POST", `/agents/${seller.id}/withdraw`, { to: dest, amount: 1 }, B)).status === 403, "withdraw with other agent's key -> 403");
  const w = await ok("POST", `/agents/${seller.id}/withdraw`, { to: dest, amount: 5 }, S);
  check(!!w.signature, "withdraw returns a signature");
  const after = (await ok("GET", `/agents/${seller.id}/balance`, undefined, S)).balance as number;
  check(Math.abs(before - 5 - after) < 1e-9, `balance reduced by withdrawal (${before} -> ${after})`);
}
check((await call("POST", "/jobs", { buyerAgentId: buyer.id })).status === 400, "invalid job body -> 400");
const stats = await ok("GET", "/stats");
check(stats.settled >= 2 && stats.volumeHidden === true, `stats: ${JSON.stringify({ jobs: stats.jobs, settled: stats.settled, agents: stats.agents })}`);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL E2E CHECKS PASSED");
process.exit(failures ? 1 : 0);
