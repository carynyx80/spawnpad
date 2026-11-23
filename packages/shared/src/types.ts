// Spawnpad shared contract. Every service imports these via relative path.
// Ports: web 3100, api 4100, verifier 4200.

export type JobKind = "data_delivery" | "code_tests";
export type JobStatus =
  | "open"        // accepting sealed bids
  | "awarded"     // buyer accepted a bid, waiting for escrow funding
  | "funded"      // escrow holds encrypted payment
  | "delivered"   // seller submitted deliverable to verifier
  | "settled"     // verifier passed, seller paid minus fee
  | "refunded"    // verifier failed or deadline passed
  | "cancelled";

export interface Agent {
  id: string;              // "agt_..."
  name: string;
  ownerWallet: string;     // owner's public Solana address
  ownerVerified?: boolean; // true when the owner wallet signed the registration message
  shieldedAddress: string; // agent's Privacy Ring shielded address
  viewingPubKey: string;   // X25519 public key (base64) used to encrypt bids/budgets to this agent
  createdAt: string;
}

export interface DataSpec {           // for data_delivery
  schema: Record<string, "string" | "number" | "boolean">;
  minRows: number;
  maxAgeSeconds?: number;             // freshness check against a "timestamp" field if present
}
export interface CodeSpec {           // for code_tests
  language: "javascript";
  entry: string;                      // exported function name the tests call
  testsHash: string;                  // sha256 of hidden test suite (tests stored server-side, encrypted)
}

export interface Job {
  id: string;                 // "job_..."
  buyerAgentId: string;
  title: string;
  description: string;
  kind: JobKind;
  spec: DataSpec | CodeSpec;
  specHash: string;           // sha256 of canonical JSON spec, committed on settlement
  encryptedBudget: string;    // sealed to buyer viewingPubKey; server never sees plaintext
  asset: "USDC";
  deadline: string;           // ISO
  status: JobStatus;
  awardedBidId?: string;
  escrowTx?: string;          // ring transfer signature buyer -> escrow
  settlementTx?: string;      // ring transfer signature escrow -> seller (or refund)
  feeTx?: string;
  attestation?: Attestation;
  bidCount: number;
  createdAt: string;
}

export interface Bid {
  id: string;                 // "bid_..."
  jobId: string;
  sellerAgentId: string;
  sealedBid: string;          // price + note encrypted to buyer viewingPubKey (opaque to server)
  createdAt: string;
}

export interface Delivery {
  jobId: string;
  sellerAgentId: string;
  payloadForVerifier: string; // base64 JSON (data rows) or JS source; MVP: plaintext to verifier
  payloadForBuyer: string;    // encrypted to buyer viewingPubKey, released after pass
  submittedAt: string;
}

export interface Attestation {
  jobId: string;
  passed: boolean;
  report: string;             // human-readable summary of checks
  deliverableHash: string;    // sha256 of payloadForVerifier
  verifiedAt: string;
  verifierPubKey: string;     // ed25519 public key (base64)
  signature: string;          // ed25519 signature (base64) over canonical JSON of the fields above minus signature
}

// Privacy ring adapter (packages/ring). Mode "mock" by default; "helius" uses @heliuslabs/spr on devnet.
export interface RingTransfer {
  signature: string;          // tx signature
  from: string;               // visible address
  to: string;                 // visible address
  encryptedAmount: string;    // what a public explorer sees (ciphertext)
  memo?: string;
  createdAt: string;
}

// ---- HTTP API (apps/api, base http://localhost:4100) ----
// GET    /health                          -> { ok: true }
// POST   /agents            {name, ownerWallet, shieldedAddress?, viewingPubKey?} -> Agent
// GET    /agents                          -> Agent[]
// GET    /agents/:id                      -> Agent
// POST   /jobs              {buyerAgentId,title,description,kind,spec,encryptedBudget,deadline, tests?} -> Job
// GET    /jobs?status=open                -> Job[]
// GET    /jobs/:id                        -> Job & { bids: Bid[] }
// POST   /jobs/:id/bids     {sellerAgentId, sealedBid} -> Bid
// POST   /jobs/:id/award    {bidId}       -> Job (status awarded)
// POST   /jobs/:id/fund     {amount}      -> Job (status funded; api calls ring adapter buyer->escrow)
// POST   /jobs/:id/deliver  {sellerAgentId,payloadForVerifier,payloadForBuyer} -> Job (delivered); api calls verifier, then settles or refunds
// GET    /jobs/:id/deliverable?agentId=   -> { payloadForBuyer } only to buyer and only once settled
// GET    /ring/transfers?address=         -> RingTransfer[]   (public-explorer view: amounts are ciphertext)
// GET    /stats                           -> { jobs, settled, agents, volumeHidden: true }
//
// ---- Verifier (services/verifier, http://localhost:4200) ----
// GET  /pubkey                             -> { verifierPubKey }
// POST /verify  {job: Job, payloadForVerifier: string, tests?: string} -> Attestation
//
// Fee: 150 bps (1.5%) taken at settlement, sent to treasury via private ring transfer.

// ---- v2 additions (binding) ----
// AUTH: POST /agents response additionally returns `apiKey` ("sk_agt_..."), shown ONCE (like ownerViewingKey).
//   Server stores only sha256(apiKey). Every mutating call made on behalf of an agent must send
//   `Authorization: Bearer <apiKey>` and the key must belong to the acting agent:
//     POST /jobs (buyer), POST /jobs/:id/bids (seller), POST /jobs/:id/award (buyer), POST /jobs/:id/fund (buyer),
//     POST /jobs/:id/deliver (awarded seller), POST /jobs/:id/cancel (buyer, only while open/awarded),
//     GET /jobs/:id/deliverable (buyer; agentId query param no longer needed), PUT /agents/:id/limits (agent).
//   401 if missing/unknown key, 403 if key belongs to a different agent.
// SPENDING LIMITS: PUT /agents/:id/limits {maxPerJob?: number, maxPerDay?: number} -> Agent & {limits}
//   /fund rejects with 422 "spending limit exceeded" when amount > maxPerJob or today's escrow total + amount > maxPerDay.
// NEW READS: GET /agents/:id/bids -> Bid[] (bids this agent placed, with job title/status)
//            GET /jobs?buyerAgentId=&sellerAgentId=&status=  (filters; sellerAgentId = awarded seller)
// AGENT fields: Agent gains optional `limits?: {maxPerJob?: number; maxPerDay?: number}` and `stats?: {posted:number; won:number; settled:number}`.
// FRONTEND KEYSTORE: the web app keeps {agentId, name, apiKey, viewingKey, viewingPubKey, shieldedAddress} per agent in
//   localStorage key "spawnpad.agents.v1" (array). Keys never leave the browser except apiKey in the Authorization header.
