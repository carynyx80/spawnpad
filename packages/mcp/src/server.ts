#!/usr/bin/env -S npx tsx
// Spawnpad MCP server: lets an AI agent use the Spawnpad private job market as tools.
// Identity comes from env: SPAWNPAD_API, SPAWNPAD_AGENT_ID, SPAWNPAD_API_KEY (sk_agt_..., sent as a Bearer token),
// SPAWNPAD_VIEWING_KEY (X25519 secret, base64; used only locally to open sealed bids and decrypt spending).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  SpawnpadClient, sealTo, openWith, toB64, fromB64, hashTests, verifyAttestation,
  type SealedBidBody, type SealedBudget, type Job, type Bid,
} from "../../sdk/src/index.ts";

const api = new SpawnpadClient({ baseUrl: process.env.SPAWNPAD_API ?? "http://localhost:4100", apiKey: process.env.SPAWNPAD_API_KEY || undefined });
const AGENT_ID = process.env.SPAWNPAD_AGENT_ID ?? "";
const VIEWING_KEY = process.env.SPAWNPAD_VIEWING_KEY ?? "";

const server = new McpServer({ name: "spawnpad", version: "0.1.0" });

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: String((e as Error)?.message ?? e) }] });
const needId = () => { if (!AGENT_ID) throw new Error("SPAWNPAD_AGENT_ID is not set"); return AGENT_ID; };
const needKey = () => { if (!VIEWING_KEY) throw new Error("SPAWNPAD_VIEWING_KEY is not set"); return VIEWING_KEY; };
const tryOpen = <T>(sealed: string): T | null => { try { return openWith<T>(needKey(), sealed); } catch { return null; } };

server.tool("spawnpad_list_jobs", "List jobs on the Spawnpad market (budgets are sealed; only the buyer can read them).",
  { status: z.enum(["open", "awarded", "funded", "delivered", "settled", "refunded", "cancelled"]).optional() },
  async ({ status }) => {
    try {
      const jobs = await api.listJobs(status);
      return text(jobs.map((j) => ({ id: j.id, title: j.title, kind: j.kind, status: j.status, bids: j.bidCount, deadline: j.deadline, buyer: j.buyerAgentId })));
    } catch (e) { return fail(e); }
  });

server.tool("spawnpad_get_job", "Get one job with its bids. If you are the buyer, sealed bids and your budget are decrypted for you.",
  { jobId: z.string() },
  async ({ jobId }) => {
    try {
      const job = await api.getJob(jobId);
      const mine = job.buyerAgentId === AGENT_ID;
      const budget = mine ? tryOpen<SealedBudget>(job.encryptedBudget) : null;
      const bids = job.bids.map((b: Bid) => ({ id: b.id, seller: b.sellerAgentId, ...(mine ? { opened: tryOpen<SealedBidBody>(b.sealedBid) } : { sealed: true }) }));
      const att = job.attestation ? { ...job.attestation, signatureValid: verifyAttestation(job.attestation as never) } : undefined;
      return text({ ...job, encryptedBudget: undefined, budget, bids, attestation: att });
    } catch (e) { return fail(e); }
  });

server.tool("spawnpad_post_job", "Post a job as this agent. Budget is sealed to your own viewing key. For code_tests, pass hidden tests as a JSON array of {args, expected}.",
  {
    title: z.string(), description: z.string(),
    kind: z.enum(["data_delivery", "code_tests"]),
    maxBudgetUsdc: z.number().positive(),
    deadlineMinutes: z.number().positive().default(60),
    dataSchema: z.record(z.enum(["string", "number", "boolean"])).optional().describe("data_delivery: field -> type"),
    minRows: z.number().int().optional(),
    entry: z.string().optional().describe("code_tests: exported function name"),
    tests: z.array(z.object({ args: z.array(z.any()), expected: z.any() })).optional(),
  },
  async (a) => {
    try {
      const me = await api.getAgent(needId());
      let spec: Job["spec"]; let testsB64: string | undefined;
      if (a.kind === "data_delivery") {
        if (!a.dataSchema) throw new Error("dataSchema is required for data_delivery");
        spec = { schema: a.dataSchema, minRows: a.minRows ?? 1 };
      } else {
        if (!a.entry || !a.tests) throw new Error("entry and tests are required for code_tests");
        testsB64 = toB64(JSON.stringify(a.tests));
        spec = { language: "javascript", entry: a.entry, testsHash: hashTests(testsB64) };
      }
      const job = await api.postJob({
        buyerAgentId: me.id, title: a.title, description: a.description, kind: a.kind, spec,
        encryptedBudget: sealTo(me.viewingPubKey, { maxPrice: a.maxBudgetUsdc, asset: "USDC" } satisfies SealedBudget),
        deadline: new Date(Date.now() + a.deadlineMinutes * 60_000).toISOString(), tests: testsB64,
      });
      return text({ posted: job.id, status: job.status, specHash: job.specHash });
    } catch (e) { return fail(e); }
  });

server.tool("spawnpad_bid", "Submit a sealed bid. The price is encrypted to the buyer's viewing key; the market never sees it.",
  { jobId: z.string(), priceUsdc: z.number().positive(), note: z.string().optional() },
  async ({ jobId, priceUsdc, note }) => {
    try {
      const job = await api.getJob(jobId);
      const buyer = await api.getAgent(job.buyerAgentId);
      const bid = await api.bid(jobId, needId(), sealTo(buyer.viewingPubKey, { price: priceUsdc, note } satisfies SealedBidBody));
      return text({ bidId: bid.id, sealed: true });
    } catch (e) { return fail(e); }
  });

server.tool("spawnpad_award", "Buyer only: award a bid.", { jobId: z.string(), bidId: z.string() },
  async ({ jobId, bidId }) => { try { const j = await api.award(jobId, bidId); return text({ id: j.id, status: j.status }); } catch (e) { return fail(e); } });

server.tool("spawnpad_fund", "Buyer only: move the awarded price into escrow with a private ring transfer. Defaults to the awarded bid's price.",
  { jobId: z.string(), amountUsdc: z.number().positive().optional() },
  async ({ jobId, amountUsdc }) => {
    try {
      let amount = amountUsdc;
      if (amount === undefined) {
        const job = await api.getJob(jobId);
        const bid = job.bids.find((b) => b.id === job.awardedBidId);
        amount = bid ? tryOpen<SealedBidBody>(bid.sealedBid)?.price : undefined;
        if (amount === undefined) throw new Error("could not read awarded bid price; pass amountUsdc");
      }
      const j = await api.fund(jobId, amount);
      return text({ id: j.id, status: j.status, escrowTx: j.escrowTx });
    } catch (e) { return fail(e); }
  });

server.tool("spawnpad_deliver", "Seller only: deliver work. `content` is the JSON rows (data_delivery) or JS source with module.exports (code_tests). The verifier checks it and the market settles or refunds.",
  { jobId: z.string(), content: z.string() },
  async ({ jobId, content }) => {
    try {
      const job = await api.getJob(jobId);
      const buyer = await api.getAgent(job.buyerAgentId);
      const j = await api.deliver(jobId, needId(), toB64(content), sealTo(buyer.viewingPubKey, { content }));
      return text({ id: j.id, status: j.status, report: j.attestation?.report, settlementTx: j.settlementTx });
    } catch (e) { return fail(e); }
  });

server.tool("spawnpad_my_spending", "Decrypt this agent's private ring history with its viewing key (owner audit). Also returns sealed budgets of jobs you posted.",
  {},
  async () => {
    try {
      const me = await api.getAgent(needId());
      const transfers = await api.transfers(me.shieldedAddress);
      const jobs = await api.listJobs({ buyerAgentId: me.id });
      return text({
        agent: me.id, address: me.shieldedAddress,
        publicView: transfers.map((t) => ({ sig: t.signature, from: t.from, to: t.to, amount: t.encryptedAmount.slice(0, 24) + "…" })),
        myJobs: jobs.map((j) => ({ id: j.id, title: j.title, status: j.status, budget: tryOpen<SealedBudget>(j.encryptedBudget) })),
        note: "Ring transfer amounts decrypt in the owner dashboard with the ring viewing key; this view shows what the public chain sees.",
      });
    } catch (e) { return fail(e); }
  });

// Exported for tests; not used at runtime.
export { fromB64 };

await server.connect(new StdioServerTransport());
