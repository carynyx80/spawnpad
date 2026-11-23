// All data access goes through here. Live API by default; set VITE_USE_API=false to use mock data.
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import type { Agent, Job, Bid, RingTransfer } from "./types";
import * as mock from "./mock";

const { decodeBase64, encodeBase64, encodeUTF8 } = naclUtil;
export const USE_API = import.meta.env.VITE_USE_API !== "false";
const BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:4100";
const get = async <T,>(p: string): Promise<T> => { const r = await fetch(BASE + p); if (!r.ok) throw new Error(`${r.status} ${p}`); return r.json(); };
const delay = <T,>(v: T) => new Promise<T>(res => setTimeout(() => res(v), 120));

export interface Stats { jobs: number; settled: number; agents: number; volumeHidden: true; escrowAddress?: string; treasuryAddress?: string; network?: "mock" | "devnet" | "mainnet"; faucet?: boolean }

/* Directory: agent names and system addresses, loaded once before the app renders. */
export const directory = { agents: [] as Agent[], escrow: mock.ESCROW, treasury: mock.TREASURY, online: true, network: "mock" as NonNullable<Stats["network"]> };
export async function loadDirectory() {
  if (!USE_API) { directory.agents = mock.agents; return; }
  try {
    const [agents, s] = await Promise.all([get<Agent[]>("/agents"), get<Stats>("/stats")]);
    directory.agents = agents;
    if (s.escrowAddress) directory.escrow = s.escrowAddress;
    if (s.treasuryAddress) directory.treasury = s.treasuryAddress;
    if (s.network) directory.network = s.network;
  } catch { directory.online = false; }
}
const sortNew = <T extends { createdAt: string }>(xs: T[]) => [...xs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const listJobs = async (filter: { buyerAgentId?: string; sellerAgentId?: string; status?: string } = {}): Promise<Job[]> => {
  if (!USE_API) return delay(mock.jobs.filter(j => (!filter.buyerAgentId || j.buyerAgentId === filter.buyerAgentId) && (!filter.status || j.status === filter.status)));
  const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString();
  return sortNew(await get<Job[]>(`/jobs${q ? `?${q}` : ""}`));
};
export const getJob = (id: string): Promise<(Job & { bids: Bid[] }) | undefined> =>
  USE_API ? get<Job & { bids: Bid[] }>(`/jobs/${id}`).catch(() => undefined) : delay((() => { const j = mock.jobs.find(x => x.id === id); return j && { ...j, bids: mock.bidsFor(id) }; })());
export const listAgents = (): Promise<Agent[]> => USE_API ? get("/agents") : delay(mock.agents);
export const listTransfers = async (address?: string): Promise<RingTransfer[]> =>
  USE_API ? sortNew(await get<RingTransfer[]>(`/ring/transfers${address ? `?address=${encodeURIComponent(address)}` : ""}`))
    : delay(address ? mock.transfers.filter(t => t.from === address || t.to === address) : mock.transfers);
export const stats = (): Promise<Stats> =>
  USE_API ? get("/stats") : delay({ jobs: mock.jobs.length, settled: mock.jobs.filter(j => j.status === "settled").length, agents: mock.agents.length, volumeHidden: true as const });

/* Owner audit: decryption runs entirely in the browser. The viewing key is never sent anywhere. */
export interface DecryptedRow { signature: string; createdAt: string; direction: "in" | "out"; amount: number; counterparty: string; jobId?: string; jobTitle: string; ciphertext: string; kind: string }
export interface AuditResult { agent?: Agent; rows: DecryptedRow[]; error?: string }
interface Envelope { signature: string; from: string; to: string; createdAt: string; direction: "in" | "out"; envelope: { nonce: string; ephemeralPubKey: string; box: string } }

const labelFor = (kind: string) => ({ escrow: "Paid into escrow", payout: "Payout from escrow", refund: "Refund from escrow", fee: "Fee" } as Record<string, string>)[kind] ?? kind;

export async function decrypt(viewingKey: string): Promise<AuditResult> {
  if (!USE_API) return delay({ agent: mock.agents[0], rows: viewingKey.trim().length >= 8 ? mock.decryptedAtlas.map(r => ({ ...r, kind: "escrow" })) : [] });
  let sk: Uint8Array;
  try { sk = decodeBase64(viewingKey.trim()); if (sk.length !== 32) throw 0; } catch { return { rows: [], error: "That isn't a valid viewing key. It should be 44 characters of base64." }; }
  const pub = encodeBase64(nacl.box.keyPair.fromSecretKey(sk).publicKey);
  const agents = await get<Agent[]>("/agents");
  const agent = agents.find(a => a.viewingPubKey === pub);
  if (!agent) return { rows: [], error: "No agent on Spawnpad matches that viewing key." };
  const [envs, pubTx, jobs] = await Promise.all([
    get<Envelope[]>(`/ring/envelopes?address=${encodeURIComponent(agent.shieldedAddress)}`),
    get<RingTransfer[]>(`/ring/transfers?address=${encodeURIComponent(agent.shieldedAddress)}`),
    get<Job[]>("/jobs"),
  ]);
  const cipherBySig = new Map(pubTx.map(t => [t.signature, t.encryptedAmount]));
  const rows: DecryptedRow[] = [];
  for (const e of envs) {
    const opened = nacl.box.open(decodeBase64(e.envelope.box), decodeBase64(e.envelope.nonce), decodeBase64(e.envelope.ephemeralPubKey), sk);
    if (!opened) continue;
    const body = JSON.parse(encodeUTF8(opened)) as { amount: number; asset: string; memo?: string };
    const m = body.memo?.match(/^spawnpad:([^:]+):(\w+)$/);
    const jobId = m?.[1]; const kind = m?.[2] ?? (e.from.startsWith("RingFaucet") || !body.memo ? "faucet" : "transfer");
    const other = e.direction === "in" ? e.from : e.to;
    rows.push({
      signature: e.signature, createdAt: e.createdAt, direction: e.direction, amount: body.amount, kind,
      counterparty: nameFor(other) ?? (kind === "faucet" ? "Devnet faucet" : other.slice(0, 6) + "…"),
      jobId, jobTitle: jobId ? (jobs.find(j => j.id === jobId)?.title ?? jobId) : (kind === "faucet" ? "Devnet faucet deposit" : body.memo ?? "Transfer"),
      ciphertext: cipherBySig.get(e.signature) ?? e.envelope.box,
    });
    rows[rows.length - 1].counterparty = jobId ? labelFor(kind) : rows[rows.length - 1].counterparty;
  }
  return { agent, rows: sortNew(rows) };
}

/* Dev only: the demo script writes demo/demo-keys.json, served by a Vite dev middleware. */
export async function demoKeys(): Promise<{ name: string; ownerViewingKey: string }[]> {
  if (!USE_API) return [{ name: "Atlas Research", ownerViewingKey: "vk_atlas_9fQ2mXc7LpR4tZ8wH1sN6bVyE3kD0aUj" }];
  try { const r = await fetch("/__demo-keys"); return r.ok ? r.json() : []; } catch { return []; }
}

export function nameFor(address: string): string | undefined {
  if (address === directory.escrow) return "Spawnpad Escrow";
  if (address === directory.treasury) return "Spawnpad Treasury";
  if (address === "RingFaucetDevnet1111111111111111111111111111") return "Devnet faucet";
  return directory.agents.find(a => a.shieldedAddress === address)?.name;
}
export const agentName = (id: string) => directory.agents.find(a => a.id === id)?.name ?? id;

/* ---------------- Writes (v2: Bearer apiKey per acting agent) ---------------- */
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
const friendly: Record<number, string> = {
  0: "Demo mode: start the API to make changes.",
  401: "This agent's API key is missing or not recognised. Re-import the agent's keys.",
  402: "Not enough private balance in this agent's wallet.",
  403: "The active agent isn't allowed to do that on this job.",
  404: "That record doesn't exist any more.",
  409: "The job has moved on since you loaded it. Refresh and try again.",
  422: "Spending limit exceeded for this agent.",
  503: "The verifier is offline right now. Try again in a moment.",
};
export const errorText = (e: unknown) => e instanceof ApiError ? (e.status === 400 || e.status === 422 || e.status === 402 ? e.message || friendly[e.status] : friendly[e.status] ?? e.message) : e instanceof Error ? e.message : String(e);

async function send<T>(method: string, path: string, body?: unknown, apiKey?: string): Promise<T> {
  if (!USE_API) throw new ApiError(0, friendly[0]);
  let r: Response;
  try {
    r = await fetch(BASE + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch { throw new ApiError(-1, "Couldn't reach the Spawnpad API."); }
  const text = await r.text();
  let data: any = undefined; try { data = text ? JSON.parse(text) : undefined; } catch { /* non-JSON */ }
  if (!r.ok) {
    const raw = data?.error ?? data?.message ?? text;
    const msg = typeof raw === "string" ? raw : JSON.stringify(raw);
    throw new ApiError(r.status, r.status === 422 && /limit/i.test(msg) ? "Spending limit exceeded for this agent." : msg);
  }
  return data as T;
}

export interface RegisterResult extends Agent { ownerViewingKey: string; apiKey?: string }
export const registerAgent = (name: string, ownerWallet: string) => send<RegisterResult>("POST", "/agents", { name, ownerWallet });
export const getAgent = (id: string): Promise<Agent & { limits?: { maxPerJob?: number; maxPerDay?: number }; stats?: { posted: number; won: number; settled: number } }> =>
  USE_API ? get(`/agents/${id}`) : delay(mock.agents.find(a => a.id === id) as Agent);
export const agentBids = async (id: string): Promise<(Bid & { jobTitle?: string; jobStatus?: string })[]> => {
  if (!USE_API) return delay([]);
  try { return await get(`/agents/${id}/bids`); } catch { return []; }
};
export const setLimits = (id: string, limits: { maxPerJob?: number | null; maxPerDay?: number | null }, apiKey?: string) => send<Agent>("PUT", `/agents/${id}/limits`, limits, apiKey);
export const agentBalance = (id: string, apiKey?: string) => send<{ agentId: string; shieldedAddress: string; asset: string; balance: number }>("GET", `/agents/${id}/balance`, undefined, apiKey);
export const withdrawFunds = (id: string, to: string, amount: number, apiKey?: string) => send<{ signature: string; to: string; amount: number; asset: string }>("POST", `/agents/${id}/withdraw`, { to, amount }, apiKey);
export const postJob = (body: Record<string, unknown>, apiKey?: string) => send<Job>("POST", "/jobs", body, apiKey);
export const placeBid = (jobId: string, sellerAgentId: string, sealedBid: string, apiKey?: string) => send<Bid>("POST", `/jobs/${jobId}/bids`, { sellerAgentId, sealedBid }, apiKey);
export const awardBid = (jobId: string, bidId: string, apiKey?: string) => send<Job>("POST", `/jobs/${jobId}/award`, { bidId }, apiKey);
export const fundEscrow = (jobId: string, amount: number, apiKey?: string) => send<Job>("POST", `/jobs/${jobId}/fund`, { amount }, apiKey);
export const deliver = (jobId: string, sellerAgentId: string, payloadForVerifier: string, payloadForBuyer: string, apiKey?: string) =>
  send<Job>("POST", `/jobs/${jobId}/deliver`, { sellerAgentId, payloadForVerifier, payloadForBuyer }, apiKey);
export const cancelJob = (jobId: string, apiKey?: string) => send<Job>("POST", `/jobs/${jobId}/cancel`, {}, apiKey);
export const getDeliverable = (jobId: string, agentId: string, apiKey?: string) => send<{ payloadForBuyer: string }>("GET", `/jobs/${jobId}/deliverable?agentId=${encodeURIComponent(agentId)}`, undefined, apiKey);
export const refreshDirectory = loadDirectory;
