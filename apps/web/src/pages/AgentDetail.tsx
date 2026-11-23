import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Briefcase, Gavel, Gauge, Download, KeyRound, ShieldCheck } from "lucide-react";
import { agentBids, getAgent, listJobs, setLimits, errorText } from "../api";
import type { Agent, Bid, Job } from "../types";
import { Card, KindBadge, Mono, StatusPill, short, timeAgo } from "../ui";
import { keystore, useKeystore, download } from "../keystore";
import { Button, CopyButton, Empty, Field, Skeleton, inputCls } from "../components/kit";
import { Avatar } from "../components/AgentSwitcher";
import { useToast } from "../components/Toast";
import { WalletCard } from "../components/WalletCard";

type FullAgent = Agent & { limits?: { maxPerJob?: number; maxPerDay?: number }; stats?: { posted: number; won: number; settled: number } };

export default function AgentDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { agents: mine, active } = useKeystore();
  const local = mine.find(m => m.agentId === id);
  const [agent, setAgent] = useState<FullAgent | null>();
  const [posted, setPosted] = useState<Job[]>([]);
  const [won, setWon] = useState<Job[]>([]);
  const [bids, setBids] = useState<(Bid & { jobTitle?: string; jobStatus?: string })[]>([]);
  const [perJob, setPerJob] = useState("");
  const [perDay, setPerDay] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const a = await getAgent(id!);
      setAgent(a ?? null);
      setPerJob(a?.limits?.maxPerJob?.toString() ?? ""); setPerDay(a?.limits?.maxPerDay?.toString() ?? "");
    } catch { setAgent(null); }
    const all = await listJobs().catch(() => [] as Job[]);
    setPosted(all.filter(j => j.buyerAgentId === id));
    setBids(await agentBids(id!));
    const sellerJobs = await listJobs({ sellerAgentId: id }).catch(() => [] as Job[]);
    setWon(sellerJobs.filter(j => j.buyerAgentId !== id && j.awardedBidId));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function saveLimits() {
    setBusy(true);
    try {
      await setLimits(id!, { maxPerJob: perJob ? Number(perJob) : null, maxPerDay: perDay ? Number(perDay) : null }, local?.apiKey);
      toast("success", "Spending limits saved", "Escrow funding above these limits will be blocked.");
      load();
    } catch (e) { toast("error", "Couldn't save limits", errorText(e)); }
    setBusy(false);
  }

  if (agent === undefined) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>;
  if (agent === null) return <Empty title="Agent not found" action={<Link to="/app/agents" className="text-sm text-violet-300">Back to agents</Link>} />;
  const stats = agent.stats ?? { posted: posted.length, won: won.length, settled: posted.filter(j => j.status === "settled").length };

  return (
    <div className="space-y-6">
      <Link to="/app/agents" className="text-sm text-muted hover:text-white">← Agents</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar name={agent.name} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-[26px] font-medium tracking-[-0.03em]">{agent.name}</h1>{local && <span className="rounded-full bg-violet-400/15 px-2.5 py-0.5 text-xs text-violet-200">Mine</span>}</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"><Mono>{agent.id}</Mono><span>Joined {timeAgo(agent.createdAt)}</span></div>
        </div>
        {local && (
          <div className="flex flex-wrap gap-2">
            {active?.agentId !== local.agentId && <Button variant="ghost" onClick={() => keystore.setActive(local.agentId)}>Act as this agent</Button>}
            <Link to="/app/audit" state={{ viewingKey: local.viewingKey }} className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2.5 text-sm font-medium hover:border-zinc-600"><ShieldCheck size={15} /> Audit spending</Link>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[["Jobs posted", stats.posted], ["Jobs won", stats.won], ["Settled as buyer", stats.settled]].map(([k, v]) => (
          <Card key={k as string} className="p-4 sm:p-5"><div className="text-xs text-muted">{k}</div><div className="mt-1.5 text-2xl font-semibold tabular-nums">{v}</div></Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <div className="flex items-center gap-2 border-b border-line px-5 py-3.5 text-sm font-medium"><Briefcase size={15} className="text-muted" /> Jobs posted</div>
            {posted.length === 0 ? <div className="p-5"><Empty title="No jobs posted" body={local ? "Post a job and let sellers bid privately." : undefined} action={local ? <Link to="/app/jobs/new" className="text-sm text-violet-300">Post a job →</Link> : undefined} /></div> : (
              <ul className="divide-y divide-line">{posted.map(j => (
                <li key={j.id}><Link to={`/app/jobs/${j.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-panel2/60"><div className="min-w-0 flex-1"><div className="truncate text-sm">{j.title}</div><div className="mt-1"><KindBadge k={j.kind} /></div></div><StatusPill s={j.status} /></Link></li>
              ))}</ul>
            )}
          </Card>
          <Card>
            <div className="flex items-center gap-2 border-b border-line px-5 py-3.5 text-sm font-medium"><Gavel size={15} className="text-muted" /> Bids placed</div>
            {bids.length === 0 ? <div className="px-5 py-6 text-sm text-muted">No bids yet.</div> : (
              <ul className="divide-y divide-line">{bids.map(b => (
                <li key={b.id}><Link to={`/app/jobs/${b.jobId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-panel2/60"><div className="min-w-0 flex-1"><div className="truncate text-sm">{b.jobTitle ?? b.jobId}</div><div className="cipher truncate text-[11.5px]">{short(b.sealedBid, 24, 8)}</div></div>{b.jobStatus && <span className="text-xs capitalize text-muted">{b.jobStatus}</span>}</Link></li>
              ))}</ul>
            )}
          </Card>
        </div>
        <div className="min-w-0 space-y-6">
          <Card className="p-5">
            <div className="text-sm font-medium">Wallet</div>
            <div className="mt-3 space-y-3 text-sm">
              <div><div className="text-xs text-muted">Shielded address</div><div className="mt-1 flex items-center gap-2"><Mono className="min-w-0 flex-1 truncate text-teal">{agent.shieldedAddress}</Mono><CopyButton text={agent.shieldedAddress} label="" /></div></div>
              <div><div className="text-xs text-muted">Owner wallet</div><Mono className="mt-1 block truncate text-zinc-400">{agent.ownerWallet}</Mono></div>
              <div><div className="text-xs text-muted">Viewing public key</div><Mono className="mt-1 block truncate text-zinc-400">{agent.viewingPubKey}</Mono></div>
            </div>
          </Card>
          {local ? (
            <>
              <WalletCard agentId={agent.id} shieldedAddress={agent.shieldedAddress} ownerWallet={agent.ownerWallet} apiKey={local.apiKey} />
              <Card className="p-5">
                <div className="flex items-center gap-2 text-sm font-medium"><Gauge size={15} className="text-violet-300" /> Spending limits</div>
                <p className="mt-1.5 text-xs text-muted">Escrow funding above these caps is rejected by Spawnpad.</p>
                <div className="mt-4 space-y-3">
                  <Field label="Max per job (USDC)"><input type="number" min="0" step="0.01" className={inputCls} value={perJob} onChange={e => setPerJob(e.target.value)} placeholder="No limit" /></Field>
                  <Field label="Max per day (USDC)"><input type="number" min="0" step="0.01" className={inputCls} value={perDay} onChange={e => setPerDay(e.target.value)} placeholder="No limit" /></Field>
                  <Button className="w-full" busy={busy} onClick={saveLimits}>Save limits</Button>
                </div>
              </Card>
              <Card className="p-5">
                <div className="flex items-center gap-2 text-sm font-medium"><KeyRound size={15} className="text-muted" /> Keys in this browser</div>
                <div className="mt-2 text-xs text-muted">API key {local.apiKey ? "saved" : "missing (read-only)"} · viewing key saved</div>
                <Button variant="ghost" className="mt-3 w-full" onClick={() => download(`${agent.name.replace(/\W+/g, "-").toLowerCase()}-keys.json`, keystore.exportJson([local]))}><Download size={15} /> Download key file</Button>
              </Card>
            </>
          ) : (
            <Card className="p-5 text-sm text-muted">This agent isn't in your browser keystore. Import its keys from the sidebar to act as it or edit limits.</Card>
          )}
        </div>
      </div>
    </div>
  );
}
