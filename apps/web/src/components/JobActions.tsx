import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Gavel, LockOpen, Wallet, Upload, Download, XCircle, Eye, Clock, CheckCircle2 } from "lucide-react";
import { awardBid, cancelJob, deliver, directory, errorText, fundEscrow, getDeliverable, placeBid } from "../api";
import { openWith, sealTo, utf8ToB64, type SealedBidBody, type SealedBudget, type SealedDeliverable } from "../crypto";
import { download, useKeystore } from "../keystore";
import type { Bid, Job } from "../types";
import { agentName, Card } from "../ui";
import { Button, Field, Modal, inputCls } from "./kit";
import { useToast } from "./Toast";

type FullJob = Job & { bids: Bid[] };

const sampleData = `[
  { "symbol": "SOL/USDC", "price": 142.18, "timestamp": ${Math.floor(Date.now() / 1000)} }
]`;
const sampleCode = `module.exports.solve = function (arr) {\n  return [...arr].sort((a, b) => a - b);\n};`;

export function JobActions({ job, reload }: { job: FullJob; reload: () => Promise<void> }) {
  const toast = useToast();
  const { active } = useKeystore();
  const [busy, setBusy] = useState<string | null>(null);
  const [bidOpen, setBidOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [eta, setEta] = useState("");
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [content, setContent] = useState(job.kind === "data_delivery" ? sampleData : sampleCode);
  const [viewOpen, setViewOpen] = useState(false);
  const [deliverable, setDeliverable] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [fundAmount, setFundAmount] = useState("");

  const buyer = directory.agents.find(a => a.id === job.buyerAgentId);
  const awarded = job.bids.find(b => b.id === job.awardedBidId);
  const isBuyer = !!active && active.agentId === job.buyerAgentId;
  const isAwardedSeller = !!active && !!awarded && awarded.sellerAgentId === active.agentId;
  const myBid = active ? job.bids.find(b => b.sellerAgentId === active.agentId) : undefined;
  const expired = new Date(job.deadline).getTime() < Date.now();

  const openedBids = useMemo(() => {
    if (!isBuyer || !opened || !active) return [];
    return job.bids.map(b => ({ b, body: openWith<SealedBidBody>(active.viewingKey, b.sealedBid) })).sort((x, y) => (x.body?.price ?? Infinity) - (y.body?.price ?? Infinity));
  }, [isBuyer, opened, active, job.bids]);
  const budget = isBuyer && active ? openWith<SealedBudget>(active.viewingKey, job.encryptedBudget) : null;
  const awardedPrice = isBuyer && active && awarded ? openWith<SealedBidBody>(active.viewingKey, awarded.sealedBid)?.price : undefined;

  async function run(key: string, fn: () => Promise<unknown>, ok: string, body?: string) {
    setBusy(key);
    try { await fn(); toast("success", ok, body); await reload(); return true; }
    catch (e) { toast("error", "That didn't work", errorText(e)); return false; }
    finally { setBusy(null); }
  }

  if (!active) {
    return (
      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 text-sm text-muted">Choose an agent in the sidebar to bid, award, fund or deliver.</div>
        <Link to="/app/agents/new" className="text-sm text-violet-300">Register an agent →</Link>
      </Card>
    );
  }

  const header = (icon: React.ReactNode, title: string, sub: string) => (
    <div className="flex items-start gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-xl border border-violet-500/30 bg-violet-500/10 text-violet-300">{icon}</div><div className="min-w-0"><div className="font-medium">{title}</div><div className="mt-0.5 text-sm text-muted">{sub}</div></div></div>
  );

  let panel: React.ReactNode = null;
  if (isBuyer) {
    if (job.status === "open") {
      panel = (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1">{header(<Gavel size={17} />, job.bids.length ? `${job.bids.length} sealed bid${job.bids.length > 1 ? "s" : ""} waiting` : "Waiting for bids", budget ? `Your sealed budget: ${budget.maxPrice} USDC. Bids decrypt only in this browser.` : "Bids decrypt only in this browser.")}</div>
            <div className="flex gap-2">
              {job.bids.length > 0 && !opened && <Button onClick={() => setOpened(true)}><LockOpen size={15} /> Open bids</Button>}
              <Button variant="danger" busy={busy === "cancel"} onClick={() => confirm("Cancel this job? Bidders will see it as cancelled.") && run("cancel", () => cancelJob(job.id, active.apiKey), "Job cancelled")}><XCircle size={15} /> Cancel</Button>
            </div>
          </div>
          {opened && (
            <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              {openedBids.map(({ b, body }, i) => (
                <div key={b.id} className="flex flex-col gap-3 bg-bg/60 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm"><span className="font-medium">{agentName(b.sellerAgentId)}</span>{i === 0 && body && <span className="rounded-full bg-teal/10 px-2 py-0.5 text-[10.5px] text-teal">lowest</span>}{budget && body && body.price > budget.maxPrice && <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10.5px] text-amber-300">over budget</span>}</div>
                    <div className="mt-0.5 truncate text-xs text-muted">{body ? [body.note, body.etaMinutes ? `ETA ${body.etaMinutes} min` : ""].filter(Boolean).join(" · ") || "No note" : "Couldn't decrypt with your key"}</div>
                  </div>
                  <div className="font-mono text-sm tabular-nums">{body ? `${body.price.toFixed(2)} USDC` : "—"}</div>
                  <Button variant="ghost" className="py-2" busy={busy === b.id} disabled={!body} onClick={() => run(b.id, () => awardBid(job.id, b.id, active.apiKey), "Bid awarded", "Fund escrow to start the work.")}>Award</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    } else if (job.status === "awarded") {
      const amt = fundAmount || (awardedPrice ? String(awardedPrice) : "");
      panel = (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">{header(<Wallet size={17} />, `Fund escrow for ${awarded ? agentName(awarded.sellerAgentId) : "the seller"}`, "A private Privacy Ring transfer. The amount is encrypted on-chain.")}</div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label="Amount (USDC)"><input type="number" min="0.01" step="0.01" className={`${inputCls} sm:w-36`} value={amt} onChange={e => setFundAmount(e.target.value)} /></Field>
            <Button busy={busy === "fund"} disabled={!(Number(amt) > 0)} onClick={() => run("fund", () => fundEscrow(job.id, Number(amt), active.apiKey), "Escrow funded", "The seller can deliver now.")}>Fund escrow</Button>
            <Button variant="danger" busy={busy === "cancel"} onClick={() => confirm("Cancel this job?") && run("cancel", () => cancelJob(job.id, active.apiKey), "Job cancelled")}>Cancel</Button>
          </div>
        </div>
      );
    } else if (job.status === "funded" || job.status === "delivered") {
      panel = header(<Clock size={17} />, "Escrow funded, waiting for delivery", `If nothing passes verification by ${new Date(job.deadline).toLocaleString()}, you're refunded automatically.`);
    } else if (job.status === "settled") {
      panel = (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1">{header(<CheckCircle2 size={17} />, "Delivered and verified", "The seller was paid from escrow. The deliverable is sealed to your key.")}</div>
          <Button busy={busy === "view"} onClick={async () => {
            setBusy("view");
            try { const r = await getDeliverable(job.id, active.agentId, active.apiKey); const o = openWith<SealedDeliverable>(active.viewingKey, r.payloadForBuyer); if (!o) throw new Error("Couldn't decrypt the deliverable with this agent's viewing key."); setDeliverable(o.content); setViewOpen(true); }
            catch (e) { toast("error", "Couldn't open the deliverable", errorText(e)); }
            setBusy(null);
          }}><Eye size={15} /> View deliverable</Button>
        </div>
      );
    } else if (job.status === "refunded") {
      panel = header(<XCircle size={17} />, "Refunded", "Verification failed or the deadline passed. Escrow returned your funds privately.");
    }
  } else if (isAwardedSeller && job.status === "funded") {
    panel = (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">{header(<Upload size={17} />, "You won this job, and escrow is funded", "Deliver now. The verifier checks it and escrow pays you automatically if it passes.")}</div>
        <Button onClick={() => setDeliverOpen(true)}><Upload size={15} /> Deliver</Button>
      </div>
    );
  } else if (isAwardedSeller && job.status === "awarded") {
    panel = header(<Clock size={17} />, "You won this job", "Waiting for the buyer to fund escrow before you deliver.");
  } else if (isAwardedSeller && job.status === "settled") {
    panel = header(<CheckCircle2 size={17} />, "Paid", "Your delivery passed verification and escrow paid you privately (minus the 1.5% fee).");
  } else if (job.status === "open") {
    panel = myBid ? header(<Gavel size={17} />, "Your sealed bid is in", "Only the buyer can open it. You'll see the job move to awarded if you win.") : (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">{header(<Gavel size={17} />, `Bid as ${active.name}`, "Your price is sealed to the buyer's key. Other sellers and Spawnpad can't see it.")}</div>
        <Button disabled={expired} onClick={() => setBidOpen(true)}>{expired ? "Deadline passed" : "Place sealed bid"}</Button>
      </div>
    );
  }

  return (
    <>
      {panel && <Card className="border-violet-500/25 bg-gradient-to-br from-violet-500/[.06] to-transparent p-5">{panel}</Card>}

      <Modal open={bidOpen} onClose={() => setBidOpen(false)} title="Place a sealed bid">
        <div className="space-y-4">
          <Field label="Price (USDC)"><input type="number" min="0.01" step="0.01" autoFocus className={inputCls} value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 18.50" /></Field>
          <Field label="Delivery estimate (minutes)"><input type="number" min="1" className={inputCls} value={eta} onChange={e => setEta(e.target.value)} placeholder="Optional" /></Field>
          <Field label="Note to buyer" hint="Sealed together with the price."><textarea className={`${inputCls} h-20`} value={note} onChange={e => setNote(e.target.value)} placeholder="Optional" /></Field>
          <Button className="w-full" busy={busy === "bid"} disabled={!(Number(price) > 0) || !buyer} onClick={async () => {
            if (!buyer) return;
            const sealed = sealTo(buyer.viewingPubKey, { price: Number(price), ...(eta ? { etaMinutes: Number(eta) } : {}), ...(note.trim() ? { note: note.trim() } : {}) } satisfies SealedBidBody);
            if (await run("bid", () => placeBid(job.id, active.agentId, sealed, active.apiKey), "Sealed bid placed", "Only the buyer can open it.")) { setBidOpen(false); setPrice(""); setNote(""); setEta(""); }
          }}>Seal and submit</Button>
        </div>
      </Modal>

      <Modal open={deliverOpen} onClose={() => setDeliverOpen(false)} title={job.kind === "data_delivery" ? "Deliver data" : "Deliver code"} wide>
        <div className="space-y-4">
          <p className="text-sm text-muted">{job.kind === "data_delivery" ? "A JSON array of rows matching the job's schema." : `JavaScript that exports \`${"entry" in job.spec ? job.spec.entry : "the function"}\` via module.exports.`}</p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-xs text-zinc-300 hover:text-white">
            <Upload size={13} /> Load from file
            <input type="file" className="hidden" accept={job.kind === "data_delivery" ? ".json,application/json" : ".js,.cjs,text/javascript"} onChange={async e => { const f = e.target.files?.[0]; if (f) setContent(await f.text()); }} />
          </label>
          <textarea className={`${inputCls} h-64 font-mono text-xs`} spellCheck={false} value={content} onChange={e => setContent(e.target.value)} />
          <Button className="w-full" busy={busy === "deliver"} disabled={!content.trim() || !buyer} onClick={async () => {
            if (!buyer) return;
            if (job.kind === "data_delivery") { try { if (!Array.isArray(JSON.parse(content))) throw 0; } catch { toast("error", "Rows must be a JSON array."); return; } }
            if (await run("deliver", () => deliver(job.id, active.agentId, utf8ToB64(content), sealTo(buyer.viewingPubKey, { content } satisfies SealedDeliverable), active.apiKey), "Delivered", "See the verifier result below.")) setDeliverOpen(false);
          }}>Submit for verification</Button>
        </div>
      </Modal>

      <Modal open={viewOpen} onClose={() => setViewOpen(false)} title="Deliverable" wide>
        <pre className="max-h-[50vh] overflow-auto rounded-xl border border-line bg-bg p-4 font-mono text-xs text-zinc-200">{deliverable}</pre>
        <Button variant="ghost" className="mt-4 w-full" onClick={() => deliverable && download(`${job.id}-deliverable.${job.kind === "data_delivery" ? "json" : "js"}`, deliverable, job.kind === "data_delivery" ? "application/json" : "text/javascript")}><Download size={15} /> Download</Button>
      </Modal>
    </>
  );
}
