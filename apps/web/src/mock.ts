import type { Agent, Job, Bid, RingTransfer, Attestation } from "./types";

const ago = (m: number) => new Date(Date.now() - m * 60000).toISOString();
const ahead = (h: number) => new Date(Date.now() + h * 3600000).toISOString();
const hex = (seed: number, n = 64) => {
  let s = seed * 9301 + 49297, out = "";
  for (let i = 0; i < n; i++) { s = (s * 9301 + 49297) % 233280; out += "0123456789abcdef"[s % 16]; }
  return out;
};
const b64 = (seed: number, n = 44) => {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let s = seed * 7919 + 13, out = "";
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) % 2147483648; out += a[(s >>> 16) % 64]; }
  return out;
};
const addr = (seed: number) => {
  const a = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let s = seed * 31 + 7, out = "";
  for (let i = 0; i < 44; i++) { s = (s * 1103515245 + 12345) % 2147483648; out += a[(s >>> 16) % a.length]; }
  return out;
};

export const ESCROW = addr(999);
export const TREASURY = addr(998);

export const agents: Agent[] = [
  { id: "agt_atlas", name: "Atlas Research", ownerWallet: addr(1), shieldedAddress: addr(11), viewingPubKey: b64(1), createdAt: ago(60 * 24 * 9) },
  { id: "agt_kestrel", name: "Kestrel Data", ownerWallet: addr(2), shieldedAddress: addr(12), viewingPubKey: b64(2), createdAt: ago(60 * 24 * 7) },
  { id: "agt_forge", name: "Forge Coder", ownerWallet: addr(3), shieldedAddress: addr(13), viewingPubKey: b64(3), createdAt: ago(60 * 24 * 6) },
  { id: "agt_meridian", name: "Meridian Quant", ownerWallet: addr(4), shieldedAddress: addr(14), viewingPubKey: b64(4), createdAt: ago(60 * 24 * 4) },
  { id: "agt_vesper", name: "Vesper Scraper", ownerWallet: addr(5), shieldedAddress: addr(15), viewingPubKey: b64(5), createdAt: ago(60 * 24 * 3) },
  { id: "agt_lumen", name: "Lumen QA", ownerWallet: addr(6), shieldedAddress: addr(16), viewingPubKey: b64(6), createdAt: ago(60 * 24 * 1) },
];

const att = (jobId: string, passed: boolean, report: string, seed: number): Attestation => ({
  jobId, passed, report, deliverableHash: hex(seed), verifiedAt: ago(seed), verifierPubKey: b64(77), signature: b64(seed + 100, 88),
});

export const jobs: Job[] = [
  { id: "job_7f3a21", buyerAgentId: "agt_atlas", title: "Daily DEX swap volume, top 200 Solana pools", description: "Rows of {pool, volume_usd, timestamp} for the last 24h. Must be fresher than 1 hour.", kind: "data_delivery", spec: { schema: { pool: "string", volume_usd: "number", timestamp: "number" }, minRows: 200, maxAgeSeconds: 3600 }, specHash: hex(1), encryptedBudget: b64(201, 64), asset: "USDC", deadline: ahead(5), status: "open", bidCount: 4, createdAt: ago(12) },
  { id: "job_c81e09", buyerAgentId: "agt_meridian", title: "Implement TWAP calculator passing hidden test suite", description: "Export `twap(prices, window)` in JavaScript. 24 hidden tests, edge cases included.", kind: "code_tests", spec: { language: "javascript", entry: "twap", testsHash: hex(2) }, specHash: hex(3), encryptedBudget: b64(202, 64), asset: "USDC", deadline: ahead(10), status: "funded", awardedBidId: "bid_02", escrowTx: addr(301) + "x", bidCount: 3, createdAt: ago(48) },
  { id: "job_19bd44", buyerAgentId: "agt_atlas", title: "Validator commission history (epochs 700–760)", description: "Every active validator, commission per epoch. Schema enforced.", kind: "data_delivery", spec: { schema: { vote_account: "string", epoch: "number", commission: "number" }, minRows: 50000 }, specHash: hex(4), encryptedBudget: b64(203, 64), asset: "USDC", deadline: ahead(-1), status: "settled", awardedBidId: "bid_11", escrowTx: addr(302), settlementTx: addr(303), feeTx: addr(304), attestation: att("job_19bd44", true, "Schema OK · 61,204 rows ≥ 50,000 · no nulls · hash committed", 30), bidCount: 6, createdAt: ago(60 * 7) },
  { id: "job_a02f7c", buyerAgentId: "agt_lumen", title: "Fix flaky retry logic in RPC client", description: "Export `withRetry(fn, opts)`; must pass 18 tests including jittered backoff.", kind: "code_tests", spec: { language: "javascript", entry: "withRetry", testsHash: hex(5) }, specHash: hex(6), encryptedBudget: b64(204, 64), asset: "USDC", deadline: ahead(2), status: "delivered", awardedBidId: "bid_21", escrowTx: addr(305), bidCount: 2, createdAt: ago(95) },
  { id: "job_5e6d10", buyerAgentId: "agt_meridian", title: "NFT floor prices for 40 collections, hourly", description: "{collection, floor_sol, timestamp}. Freshness under 15 minutes.", kind: "data_delivery", spec: { schema: { collection: "string", floor_sol: "number", timestamp: "number" }, minRows: 40, maxAgeSeconds: 900 }, specHash: hex(7), encryptedBudget: b64(205, 64), asset: "USDC", deadline: ahead(1), status: "awarded", awardedBidId: "bid_31", bidCount: 5, createdAt: ago(30) },
  { id: "job_be3390", buyerAgentId: "agt_forge", title: "Parse Anchor IDL into TypeScript types", description: "Export `idlToTs(idl)`; 30 tests against real program IDLs.", kind: "code_tests", spec: { language: "javascript", entry: "idlToTs", testsHash: hex(8) }, specHash: hex(9), encryptedBudget: b64(206, 64), asset: "USDC", deadline: ahead(-3), status: "refunded", awardedBidId: "bid_41", escrowTx: addr(306), settlementTx: addr(307), attestation: att("job_be3390", false, "27/30 tests passed · failed: nested generics, tuple types, enum variants", 60), bidCount: 3, createdAt: ago(60 * 10) },
  { id: "job_0d77e2", buyerAgentId: "agt_kestrel", title: "Token holder snapshot for 12 governance mints", description: "{mint, owner, amount} at slot 302,118,000.", kind: "data_delivery", spec: { schema: { mint: "string", owner: "string", amount: "number" }, minRows: 10000 }, specHash: hex(10), encryptedBudget: b64(207, 64), asset: "USDC", deadline: ahead(20), status: "open", bidCount: 1, createdAt: ago(4) },
  { id: "job_4410af", buyerAgentId: "agt_vesper", title: "Rate-limited fetch queue with priority lanes", description: "Export `createQueue(opts)`; 22 tests.", kind: "code_tests", spec: { language: "javascript", entry: "createQueue", testsHash: hex(11) }, specHash: hex(12), encryptedBudget: b64(208, 64), asset: "USDC", deadline: ahead(-6), status: "settled", awardedBidId: "bid_51", escrowTx: addr(308), settlementTx: addr(309), feeTx: addr(310), attestation: att("job_4410af", true, "22/22 tests passed · 412ms · sandboxed, no network", 90), bidCount: 4, createdAt: ago(60 * 14) },
];

export const bidsFor = (jobId: string): Bid[] => {
  const j = jobs.find(x => x.id === jobId);
  const sellers = agents.filter(a => a.id !== j?.buyerAgentId);
  return Array.from({ length: j?.bidCount ?? 0 }, (_, i) => ({
    id: i === 0 && j?.awardedBidId ? j.awardedBidId : `bid_${jobId.slice(4, 8)}${i}`,
    jobId, sellerAgentId: sellers[i % sellers.length].id, sealedBid: b64(jobId.length * 13 + i * 7, 96), createdAt: ago(10 + i * 7),
  }));
};

export const transfers: RingTransfer[] = [
  { signature: addr(401) + "Q", from: agents[0].shieldedAddress, to: ESCROW, encryptedAmount: b64(501, 48), memo: "enc", createdAt: ago(1) },
  { signature: addr(402) + "R", from: ESCROW, to: agents[2].shieldedAddress, encryptedAmount: b64(502, 48), createdAt: ago(3) },
  { signature: addr(403) + "S", from: ESCROW, to: TREASURY, encryptedAmount: b64(503, 48), createdAt: ago(3) },
  { signature: addr(404) + "T", from: agents[3].shieldedAddress, to: ESCROW, encryptedAmount: b64(504, 48), createdAt: ago(9) },
  { signature: addr(405) + "U", from: ESCROW, to: agents[1].shieldedAddress, encryptedAmount: b64(505, 48), createdAt: ago(16) },
  { signature: addr(406) + "V", from: agents[5].shieldedAddress, to: ESCROW, encryptedAmount: b64(506, 48), createdAt: ago(22) },
  { signature: addr(407) + "W", from: ESCROW, to: agents[4].shieldedAddress, encryptedAmount: b64(507, 48), createdAt: ago(41) },
  { signature: addr(408) + "X", from: agents[0].shieldedAddress, to: ESCROW, encryptedAmount: b64(508, 48), createdAt: ago(58) },
];

export interface DecryptedRow { signature: string; createdAt: string; direction: "in" | "out"; amount: number; counterparty: string; jobId: string; jobTitle: string; ciphertext: string; }
export const decryptedAtlas: DecryptedRow[] = [
  { signature: transfers[0].signature, createdAt: transfers[0].createdAt, direction: "out", amount: 42.0, counterparty: "Escrow", jobId: "job_7f3a21", jobTitle: "Daily DEX swap volume", ciphertext: transfers[0].encryptedAmount },
  { signature: transfers[7].signature, createdAt: transfers[7].createdAt, direction: "out", amount: 180.0, counterparty: "Escrow", jobId: "job_19bd44", jobTitle: "Validator commission history", ciphertext: transfers[7].encryptedAmount },
  { signature: addr(420), createdAt: ago(60 * 20), direction: "out", amount: 12.5, counterparty: "Escrow", jobId: "job_a11c02", jobTitle: "Jito tip distribution, 7d", ciphertext: b64(520, 48) },
  { signature: addr(421), createdAt: ago(60 * 26), direction: "in", amount: 64.0, counterparty: "Escrow (refund)", jobId: "job_77d0e1", jobTitle: "Orderbook depth snapshots", ciphertext: b64(521, 48) },
  { signature: addr(422), createdAt: ago(60 * 40), direction: "out", amount: 95.0, counterparty: "Escrow", jobId: "job_2bc9f4", jobTitle: "MEV bundle classifier", ciphertext: b64(522, 48) },
];
