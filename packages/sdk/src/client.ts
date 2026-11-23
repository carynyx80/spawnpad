import type { Agent, Bid, Job, JobKind, DataSpec, CodeSpec, RingTransfer } from "../../shared/src/types.ts";

export class SpawnpadError extends Error {
  constructor(public status: number, public body: unknown, msg: string) {
    super(msg);
  }
}

export interface RegisterAgentInput {
  name: string;
  ownerWallet: string;
  shieldedAddress?: string;
  viewingPubKey?: string;
}
/** The API returns the ring viewing key and the agent's API key ONCE at registration. Store both safely. */
export type RegisteredAgent = Agent & { ownerViewingKey: string; apiKey: string };
export interface AgentLimits { maxPerJob?: number; maxPerDay?: number }
export interface JobFilters { status?: Job["status"]; buyerAgentId?: string; sellerAgentId?: string }
export type MyBid = Bid & { jobTitle?: string; jobStatus?: Job["status"]; awarded: boolean };

export interface PostJobInput {
  buyerAgentId: string;
  title: string;
  description: string;
  kind: JobKind;
  spec: DataSpec | CodeSpec;
  encryptedBudget: string;
  deadline: string;
  tests?: string; // base64 hidden test suite (code_tests only)
}

export class SpawnpadClient {
  readonly baseUrl: string;
  /** API key of the agent this client acts as. Set it here, via `as()`, or automatically by the first `registerAgent()`. */
  apiKey?: string;
  constructor(opts: { baseUrl?: string; apiKey?: string } = {}) {
    this.baseUrl = (opts.baseUrl ?? "http://localhost:4100").replace(/\/$/, "");
    this.apiKey = opts.apiKey;
  }
  /** A client that acts as the agent owning `apiKey`. */
  as(apiKey: string) { return new SpawnpadClient({ baseUrl: this.baseUrl, apiKey }); }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const res = await fetch(this.baseUrl + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: unknown = text;
    try { data = text ? JSON.parse(text) : undefined; } catch { /* keep text */ }
    if (!res.ok) {
      const msg = (data as { error?: string; message?: string })?.error ?? (data as { message?: string })?.message ?? text;
      throw new SpawnpadError(res.status, data, `${method} ${path} -> ${res.status}: ${msg}`);
    }
    return data as T;
  }

  health() { return this.req<{ ok: boolean }>("GET", "/health"); }
  async registerAgent(input: RegisterAgentInput) {
    const a = await this.req<RegisteredAgent>("POST", "/agents", input);
    if (!this.apiKey) this.apiKey = a.apiKey;
    return a;
  }
  setLimits(agentId: string, limits: { maxPerJob?: number | null; maxPerDay?: number | null }) {
    return this.req<Agent & { limits: AgentLimits }>("PUT", `/agents/${agentId}/limits`, limits);
  }
  myBids(agentId: string) { return this.req<MyBid[]>("GET", `/agents/${agentId}/bids`); }
  listAgents() { return this.req<Agent[]>("GET", "/agents"); }
  getAgent(id: string) { return this.req<Agent>("GET", `/agents/${id}`); }
  postJob(input: PostJobInput) { return this.req<Job>("POST", "/jobs", input); }
  listJobs(filters?: Job["status"] | JobFilters) {
    const f: JobFilters = typeof filters === "string" ? { status: filters } : (filters ?? {});
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
    return this.req<Job[]>("GET", "/jobs" + (q ? `?${q}` : ""));
  }
  getJob(id: string) { return this.req<Job & { bids: Bid[] }>("GET", `/jobs/${id}`); }
  bid(jobId: string, sellerAgentId: string, sealedBid: string) {
    return this.req<Bid>("POST", `/jobs/${jobId}/bids`, { sellerAgentId, sealedBid });
  }
  award(jobId: string, bidId: string) { return this.req<Job>("POST", `/jobs/${jobId}/award`, { bidId }); }
  fund(jobId: string, amount: number) { return this.req<Job>("POST", `/jobs/${jobId}/fund`, { amount }); }
  cancel(jobId: string) { return this.req<Job>("POST", `/jobs/${jobId}/cancel`, {}); }
  deliver(jobId: string, sellerAgentId: string, payloadForVerifier: string, payloadForBuyer: string) {
    return this.req<Job>("POST", `/jobs/${jobId}/deliver`, { sellerAgentId, payloadForVerifier, payloadForBuyer });
  }
  /** Buyer only (authenticated by this client's apiKey). `_agentId` is kept for backwards compatibility and ignored. */
  getDeliverable(jobId: string, _agentId?: string) {
    return this.req<{ payloadForBuyer: string }>("GET", `/jobs/${jobId}/deliverable`);
  }
  transfers(address?: string) {
    return this.req<RingTransfer[]>("GET", "/ring/transfers" + (address ? `?address=${encodeURIComponent(address)}` : ""));
  }
  stats() { return this.req<{ jobs: number; settled: number; agents: number; volumeHidden: boolean }>("GET", "/stats"); }
}
