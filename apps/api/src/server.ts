import Fastify, { type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Agent, Job, Bid, Attestation, JobStatus, Delivery } from "../../../packages/shared/src/types.ts";
import type { ShieldedWallet } from "../../../packages/shared/src/ring-interface.ts";
import { openDb } from "./db.ts";
import { loadRing } from "./ring.ts";
import { canonical, sha256Hex, verifyEd25519 } from "./canonical.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(here, "../../../data");
const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 4100);
const VERIFIER_URL = process.env.VERIFIER_URL ?? "http://localhost:4200";
const FEE_BPS = 150;
const FAUCET = 1000;

const db = openDb(DATA_DIR);
const ring = await loadRing(DATA_DIR);
const isFallback = !(await import("node:fs")).existsSync(path.resolve(here, "../../../packages/ring/src/index.ts"));

// ---------- system wallets (escrow + treasury) ----------
async function systemWallet(role: "escrow" | "treasury"): Promise<ShieldedWallet> {
  const row = db.prepare("SELECT data FROM system_wallets WHERE role=?").get(role) as { data: string } | undefined;
  if (row && !isFallback) {
    const saved = JSON.parse(row.data);
    if (saved.ringTag === ring.mode) return saved.wallet;
  }
  const wallet = await ring.createShieldedWallet(`spawnpad-${role}`);
  db.prepare("INSERT OR REPLACE INTO system_wallets(role,data) VALUES(?,?)").run(role, JSON.stringify({ ringTag: ring.mode, wallet }));
  return wallet;
}
const escrow = await systemWallet("escrow");
const treasury = await systemWallet("treasury");

// ---------- helpers ----------
const id = (p: string) => `${p}_${randomBytes(9).toString("base64url")}`;
const now = () => new Date().toISOString();

function getAgent(agentId: string): (Agent & { keyId: string }) | undefined {
  const r = db.prepare("SELECT key_id, data FROM agents WHERE id=?").get(agentId) as { key_id: string; data: string } | undefined;
  return r ? { ...JSON.parse(r.data), keyId: r.key_id } : undefined;
}
type Limits = { maxPerJob?: number; maxPerDay?: number };
type StoredAgent = Agent & { keyId: string; apiKeyHash?: string; limits?: Limits };
const hashKey = (k: string) => createHash("sha256").update(k).digest("hex");
function agentStats(agentId: string) {
  const jobs = (db.prepare("SELECT data FROM jobs").all() as { data: string }[]).map((r) => JSON.parse(r.data) as Job);
  const bids = (db.prepare("SELECT data FROM bids").all() as { data: string }[]).map((r) => JSON.parse(r.data) as Bid);
  const myBidIds = new Set(bids.filter((b) => b.sellerAgentId === agentId).map((b) => b.id));
  const won = jobs.filter((j) => j.awardedBidId && myBidIds.has(j.awardedBidId));
  return { posted: jobs.filter((j) => j.buyerAgentId === agentId).length, won: won.length, settled: won.filter((j) => j.status === "settled").length };
}
const publicAgent = (a: Agent & { keyId?: string }): Agent => {
  const { keyId: _k, apiKeyHash: _h, ...rest } = a as any;
  return { ...rest, limits: rest.limits ?? {}, stats: agentStats(rest.id) };
};
function saveAgent(a: StoredAgent) {
  const { keyId, ...data } = a;
  db.prepare("UPDATE agents SET data=? WHERE id=?").run(JSON.stringify(data), a.id);
}
// Bearer auth: the key must belong to `actingAgentId`.
function requireAgent(req: { headers: Record<string, any> }, actingAgentId: string): StoredAgent {
  const h = String(req.headers.authorization ?? "");
  const m = h.match(/^Bearer\s+(\S+)$/i);
  if (!m) throw new HttpError(401, "missing Authorization: Bearer <apiKey>");
  const hash = hashKey(m[1]);
  const rows = db.prepare("SELECT id FROM agents").all() as { id: string }[];
  const owner = rows.map((r) => getAgent(r.id) as StoredAgent).find((a) => a?.apiKeyHash === hash);
  if (!owner) throw new HttpError(401, "unknown api key");
  if (owner.id !== actingAgentId) throw new HttpError(403, "api key belongs to a different agent");
  return owner;
}
function getJob(jobId: string): Job | undefined {
  const r = db.prepare("SELECT data FROM jobs WHERE id=?").get(jobId) as { data: string } | undefined;
  return r ? JSON.parse(r.data) : undefined;
}
function saveJob(j: Job) {
  j.bidCount = (db.prepare("SELECT COUNT(*) c FROM bids WHERE job_id=?").get(j.id) as { c: number }).c;
  db.prepare("INSERT OR REPLACE INTO jobs(id,status,created_at,data) VALUES(?,?,?,?)").run(j.id, j.status, j.createdAt, JSON.stringify(j));
}
function bidsFor(jobId: string): Bid[] {
  return (db.prepare("SELECT data FROM bids WHERE job_id=? ORDER BY rowid").all(jobId) as { data: string }[]).map((r) => JSON.parse(r.data));
}
class HttpError extends Error { constructor(public code: number, msg: string) { super(msg); } }
const need = <T>(v: T | undefined, what: string): T => { if (!v) throw new HttpError(404, `${what} not found`); return v; };
function expectStatus(j: Job, ...allowed: JobStatus[]) {
  if (!allowed.includes(j.status)) throw new HttpError(409, `job is ${j.status}; expected ${allowed.join(" or ")}`);
}

// Amount held in escrow for a job, recovered by decrypting the escrow wallet's own ring history.
async function escrowedAmount(j: Job): Promise<number> {
  const txs = await ring.decryptForViewer(escrow.viewingKey, escrow.address);
  const t = txs.find((x) => x.signature === j.escrowTx);
  if (!t) throw new HttpError(500, "escrow transfer not found in ring");
  return t.amount;
}

async function settle(j: Job, passed: boolean) {
  const amount = await escrowedAmount(j);
  if (passed) {
    const bid = bidsFor(j.id).find((b) => b.id === j.awardedBidId)!;
    const seller = getAgent(bid.sellerAgentId)!;
    const fee = Math.round(amount * FEE_BPS) / 10000;
    const payout = Math.round((amount - fee) * 1e6) / 1e6;
    const pay = await ring.transfer({ fromKeyId: escrow.keyId, to: seller.shieldedAddress, amount: payout, memo: `spawnpad:${j.id}:payout` });
    j.settlementTx = pay.signature;
    if (fee > 0) {
      const f = await ring.transfer({ fromKeyId: escrow.keyId, to: treasury.address, amount: fee, memo: `spawnpad:${j.id}:fee` });
      j.feeTx = f.signature;
    }
    j.status = "settled";
  } else {
    const buyer = getAgent(j.buyerAgentId)!;
    const r = await ring.transfer({ fromKeyId: escrow.keyId, to: buyer.shieldedAddress, amount, memo: `spawnpad:${j.id}:refund` });
    j.settlementTx = r.signature;
    j.status = "refunded";
  }
  saveJob(j);
}

let verifierKeyCache: string | undefined;
async function verifierPubKey(): Promise<string> {
  if (verifierKeyCache) return verifierKeyCache;
  const res = await fetch(`${VERIFIER_URL}/pubkey`);
  if (!res.ok) throw new Error("verifier pubkey unavailable");
  verifierKeyCache = ((await res.json()) as { verifierPubKey: string }).verifierPubKey;
  return verifierKeyCache;
}
async function verifierUp(): Promise<boolean> {
  try { await verifierPubKey(); return true; } catch { verifierKeyCache = undefined; return false; }
}

// ---------- schemas ----------
const DataSpecZ = z.object({
  schema: z.record(z.enum(["string", "number", "boolean"])).refine((s) => Object.keys(s).length > 0, "schema must have fields"),
  minRows: z.number().int().min(1),
  maxAgeSeconds: z.number().int().positive().optional(),
}).strict();
const CodeSpecZ = z.object({
  language: z.literal("javascript"),
  entry: z.string().min(1),
  testsHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
const AgentZ = z.object({
  name: z.string().min(1).max(80),
  ownerWallet: z.string().min(1).max(100),
  shieldedAddress: z.string().optional(),
  viewingPubKey: z.string().optional(),
});
const JobZ = z.object({
  buyerAgentId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).default(""),
  kind: z.enum(["data_delivery", "code_tests"]),
  spec: z.unknown(),
  encryptedBudget: z.string().min(1),
  deadline: z.string().datetime({ offset: true }),
  tests: z.string().optional(),
});

// ---------- app ----------
// trustProxy: behind Railway/Vercel proxies, rate limiting must key on the real client IP.
const app = Fastify({ logger: { level: "info" }, bodyLimit: 5 * 1024 * 1024, trustProxy: true });
// Allowed browser origins: localhost for dev plus anything in CORS_ORIGINS (comma-separated, e.g. https://www.spawnpad.online).
const corsOrigins = ["http://localhost:3100", "http://127.0.0.1:3100", ...(process.env.CORS_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean)];
await app.register(cors, { origin: corsOrigins, methods: ["GET", "POST", "PUT", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization"] });
// 600 req/min per IP by default: high enough for the dashboard plus seed scripts locally; tighten with RATE_LIMIT in production.
await app.register(rateLimit, { max: Number(process.env.RATE_LIMIT ?? 600), timeWindow: "1 minute" });

app.setErrorHandler((err: any, _req, reply: FastifyReply) => {
  if (err instanceof HttpError) return reply.code(err.code).send({ error: err.message });
  if (err instanceof z.ZodError) return reply.code(400).send({ error: "invalid input", issues: err.issues });
  if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
  app.log.error(err);
  return reply.code(500).send({ error: err.message ?? "internal error" });
});

app.get("/health", async () => ({ ok: true, ring: ring.mode, fallbackRing: isFallback, verifier: await verifierUp() }));

app.post("/agents", async (req, reply) => {
  const b = AgentZ.parse(req.body);
  const w = await ring.createShieldedWallet(b.name);
  await ring.deposit(w.keyId, FAUCET);
  // Note: a client-supplied shieldedAddress/viewingPubKey is ignored in custodial mock mode; the ring wallet is authoritative.
  const apiKey = `sk_agt_${randomBytes(24).toString("base64url")}`;
  const agent: Agent = { id: id("agt"), name: b.name, ownerWallet: b.ownerWallet, shieldedAddress: w.address, viewingPubKey: w.viewingPubKey, createdAt: now() };
  db.prepare("INSERT INTO agents(id,key_id,data) VALUES(?,?,?)").run(agent.id, w.keyId, JSON.stringify({ ...agent, apiKeyHash: hashKey(apiKey), limits: {} }));
  return reply.code(201).send({ ...publicAgent(agent), ownerViewingKey: w.viewingKey, apiKey });
});
app.get("/agents", async () =>
  (db.prepare("SELECT data FROM agents ORDER BY rowid").all() as { data: string }[]).map((r) => publicAgent(JSON.parse(r.data))));

app.put<{ Params: { id: string } }>("/agents/:id/limits", async (req) => {
  const a = need(getAgent(req.params.id), "agent") as StoredAgent;
  requireAgent(req, a.id);
  const body = z.object({ maxPerJob: z.number().positive().max(1e9).nullable().optional(), maxPerDay: z.number().positive().max(1e9).nullable().optional() }).strict().parse(req.body);
  const limits: Limits = { ...(a.limits ?? {}) };
  for (const k of ["maxPerJob", "maxPerDay"] as const) {
    if (body[k] === null) delete limits[k]; else if (body[k] !== undefined) limits[k] = body[k]!;
  }
  a.limits = limits; saveAgent(a);
  return publicAgent(a);
});

app.get<{ Params: { id: string } }>("/agents/:id/bids", async (req) => {
  need(getAgent(req.params.id), "agent");
  const bids = (db.prepare("SELECT data FROM bids ORDER BY rowid DESC").all() as { data: string }[]).map((r) => JSON.parse(r.data) as Bid).filter((b) => b.sellerAgentId === req.params.id);
  return bids.map((b) => { const j = getJob(b.jobId); return { ...b, jobTitle: j?.title, jobStatus: j?.status, awarded: j?.awardedBidId === b.id }; });
});
app.get<{ Params: { id: string } }>("/agents/:id", async (req) => publicAgent(need(getAgent(req.params.id), "agent")));

app.post("/jobs", async (req, reply) => {
  const b = JobZ.parse(req.body);
  need(getAgent(b.buyerAgentId), "buyer agent");
  requireAgent(req, b.buyerAgentId);
  if (new Date(b.deadline).getTime() <= Date.now()) throw new HttpError(400, "deadline must be in the future");
  let spec;
  if (b.kind === "data_delivery") spec = DataSpecZ.parse(b.spec);
  else {
    spec = CodeSpecZ.parse(b.spec);
    if (!b.tests) throw new HttpError(400, "code_tests jobs require hidden `tests` (base64)");
    const actual = sha256Hex(Buffer.from(b.tests, "base64"));
    if (actual !== spec.testsHash) throw new HttpError(400, "testsHash does not match sha256 of decoded tests");
  }
  const job: Job = {
    id: id("job"), buyerAgentId: b.buyerAgentId, title: b.title, description: b.description, kind: b.kind, spec,
    specHash: sha256Hex(canonical(spec)), encryptedBudget: b.encryptedBudget, asset: "USDC",
    deadline: new Date(b.deadline).toISOString(), status: "open", bidCount: 0, createdAt: now(),
  };
  saveJob(job);
  if (b.tests) db.prepare("INSERT INTO hidden_tests(job_id,tests) VALUES(?,?)").run(job.id, b.tests);
  return reply.code(201).send(job);
});
app.get<{ Querystring: { status?: string; buyerAgentId?: string; sellerAgentId?: string } }>("/jobs", async (req) => {
  const { status, buyerAgentId, sellerAgentId } = req.query;
  let jobs = (db.prepare("SELECT data FROM jobs ORDER BY created_at DESC").all() as { data: string }[]).map((r) => JSON.parse(r.data) as Job);
  if (status) jobs = jobs.filter((j) => j.status === status);
  if (buyerAgentId) jobs = jobs.filter((j) => j.buyerAgentId === buyerAgentId);
  if (sellerAgentId) jobs = jobs.filter((j) => j.awardedBidId && bidsFor(j.id).find((b) => b.id === j.awardedBidId)?.sellerAgentId === sellerAgentId);
  return jobs;
});
app.get<{ Params: { id: string } }>("/jobs/:id", async (req) => {
  const j = need(getJob(req.params.id), "job");
  return { ...j, bids: bidsFor(j.id) };
});

app.post<{ Params: { id: string } }>("/jobs/:id/bids", async (req, reply) => {
  const b = z.object({ sellerAgentId: z.string(), sealedBid: z.string().min(1).max(10000) }).parse(req.body);
  const j = need(getJob(req.params.id), "job");
  need(getAgent(b.sellerAgentId), "seller agent");
  requireAgent(req, b.sellerAgentId);
  expectStatus(j, "open");
  if (b.sellerAgentId === j.buyerAgentId) throw new HttpError(400, "buyer cannot bid on own job");
  if (new Date(j.deadline).getTime() <= Date.now()) throw new HttpError(409, "job deadline passed");
  const bid: Bid = { id: id("bid"), jobId: j.id, sellerAgentId: b.sellerAgentId, sealedBid: b.sealedBid, createdAt: now() };
  db.prepare("INSERT INTO bids(id,job_id,data) VALUES(?,?,?)").run(bid.id, j.id, JSON.stringify(bid));
  saveJob(j);
  return reply.code(201).send(bid);
});

app.post<{ Params: { id: string } }>("/jobs/:id/award", async (req) => {
  const { bidId } = z.object({ bidId: z.string() }).parse(req.body);
  const j = need(getJob(req.params.id), "job");
  requireAgent(req, j.buyerAgentId);
  expectStatus(j, "open");
  if (!bidsFor(j.id).some((b) => b.id === bidId)) throw new HttpError(404, "bid not found on this job");
  j.awardedBidId = bidId; j.status = "awarded";
  saveJob(j);
  return j;
});

app.post<{ Params: { id: string } }>("/jobs/:id/cancel", async (req) => {
  const j = need(getJob(req.params.id), "job");
  requireAgent(req, j.buyerAgentId);
  expectStatus(j, "open", "awarded");
  j.status = "cancelled";
  saveJob(j);
  return j;
});

app.post<{ Params: { id: string } }>("/jobs/:id/fund", async (req) => {
  const { amount } = z.object({ amount: z.number().positive().max(1e9) }).parse(req.body);
  const j = need(getJob(req.params.id), "job");
  const buyer = need(getAgent(j.buyerAgentId), "buyer agent") as StoredAgent;
  requireAgent(req, j.buyerAgentId);
  expectStatus(j, "awarded");
  const lim = buyer.limits ?? {};
  if (lim.maxPerJob !== undefined && amount > lim.maxPerJob) throw new HttpError(422, `spending limit exceeded: ${amount} > maxPerJob ${lim.maxPerJob}`);
  if (lim.maxPerDay !== undefined) {
    const since = Date.now() - 86_400_000;
    const sigs = new Set((db.prepare("SELECT data FROM jobs").all() as { data: string }[]).map((r) => JSON.parse(r.data) as Job).filter((x) => x.buyerAgentId === buyer.id && x.escrowTx).map((x) => x.escrowTx!));
    const mine = await ring.decryptForViewer(escrow.viewingKey, escrow.address);
    const today = mine.filter((t) => sigs.has(t.signature) && new Date(t.createdAt).getTime() >= since).reduce((s, t) => s + t.amount, 0);
    if (today + amount > lim.maxPerDay) throw new HttpError(422, `spending limit exceeded: ${today} + ${amount} > maxPerDay ${lim.maxPerDay}`);
  }
  if ((await ring.balance(buyer.keyId)) < amount) throw new HttpError(402, "insufficient private balance");
  const t = await ring.transfer({ fromKeyId: buyer.keyId, to: escrow.address, amount, memo: `spawnpad:${j.id}:escrow` });
  j.escrowTx = t.signature; j.status = "funded";
  saveJob(j);
  return j;
});

app.post<{ Params: { id: string } }>("/jobs/:id/deliver", async (req, reply) => {
  const b = z.object({ sellerAgentId: z.string(), payloadForVerifier: z.string().min(1), payloadForBuyer: z.string().min(1) }).parse(req.body);
  const j = need(getJob(req.params.id), "job");
  requireAgent(req, b.sellerAgentId);
  expectStatus(j, "funded");
  const bid = bidsFor(j.id).find((x) => x.id === j.awardedBidId)!;
  if (bid.sellerAgentId !== b.sellerAgentId) throw new HttpError(403, "only the awarded seller can deliver");
  if (!(await verifierUp())) return reply.code(503).send({ error: "verifier unavailable" });

  const delivery: Delivery = { jobId: j.id, ...b, submittedAt: now() };
  db.prepare("INSERT OR REPLACE INTO deliveries(job_id,data) VALUES(?,?)").run(j.id, JSON.stringify(delivery));
  j.status = "delivered"; saveJob(j);

  const tests = (db.prepare("SELECT tests FROM hidden_tests WHERE job_id=?").get(j.id) as { tests: string } | undefined)?.tests;
  let att: Attestation;
  try {
    const res = await fetch(`${VERIFIER_URL}/verify`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ job: j, payloadForVerifier: b.payloadForVerifier, tests }),
    });
    if (!res.ok) throw new Error(`verifier returned ${res.status}: ${await res.text()}`);
    att = (await res.json()) as Attestation;
  } catch (e: any) {
    // Leave job in "delivered"; the deadline sweeper refunds if the verifier never answers.
    return reply.code(502).send({ error: `verification failed to run: ${e.message}` });
  }

  const pub = await verifierPubKey();
  const { signature, ...unsigned } = att;
  const sigOk = att.verifierPubKey === pub && verifyEd25519(pub, canonical(unsigned), signature);
  const hashOk = att.deliverableHash === sha256Hex(Buffer.from(b.payloadForVerifier, "base64")) && att.jobId === j.id;
  if (!sigOk || !hashOk) {
    app.log.error({ sigOk, hashOk }, "attestation rejected");
    return reply.code(502).send({ error: "verifier attestation invalid", sigOk, hashOk });
  }
  j.attestation = att;
  await settle(j, att.passed);
  return j;
});

app.get<{ Params: { id: string } }>("/jobs/:id/deliverable", async (req) => {
  const j = need(getJob(req.params.id), "job");
  requireAgent(req, j.buyerAgentId);
  if (j.status !== "settled") throw new HttpError(409, "deliverable is released only after settlement");
  const d = db.prepare("SELECT data FROM deliveries WHERE job_id=?").get(j.id) as { data: string };
  return { payloadForBuyer: (JSON.parse(d.data) as Delivery).payloadForBuyer };
});

app.get<{ Querystring: { address?: string } }>("/ring/transfers", async (req) => ring.listTransfers(req.query.address));

app.get<{ Querystring: { address?: string } }>("/ring/envelopes", async (req) => {
  if (!req.query.address) throw new HttpError(400, "address is required");
  if (!ring.listEnvelopes) throw new HttpError(501, `envelopes not supported in ${ring.mode} ring mode`);
  return ring.listEnvelopes(req.query.address);
});

app.get("/stats", async () => ({
  jobs: (db.prepare("SELECT COUNT(*) c FROM jobs").get() as { c: number }).c,
  settled: (db.prepare("SELECT COUNT(*) c FROM jobs WHERE status='settled'").get() as { c: number }).c,
  agents: (db.prepare("SELECT COUNT(*) c FROM agents").get() as { c: number }).c,
  volumeHidden: true,
  escrowAddress: escrow.address,
  treasuryAddress: treasury.address,
}));

// ---------- deadline sweeper ----------
let sweeping = false;
async function sweep() {
  if (sweeping) return; sweeping = true;
  try {
    const rows = db.prepare("SELECT data FROM jobs WHERE status IN ('funded','delivered')").all() as { data: string }[];
    for (const r of rows) {
      const j = JSON.parse(r.data) as Job;
      if (new Date(j.deadline).getTime() < Date.now()) {
        try { await settle(j, false); app.log.info({ job: j.id }, "deadline passed, refunded"); }
        catch (e) { app.log.error(e, `sweep refund failed for ${j.id}`); }
      }
    }
  } finally { sweeping = false; }
}
setInterval(sweep, 30_000).unref();

await app.listen({ port: PORT, host: process.env.API_HOST ?? "127.0.0.1" });
app.log.info(`spawnpad api on :${PORT} (ring=${ring.mode}${isFallback ? ", fallback" : ""}) escrow=${escrow.address}`);
