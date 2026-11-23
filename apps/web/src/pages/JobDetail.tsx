import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getJob } from "../api";
import { JobActions } from "../components/JobActions";
import { Skeleton, Empty } from "../components/kit";
import type { Bid, Job, JobStatus } from "../types";
import { Card, KindBadge, Lock, Mono, StatusPill, agentName, short, timeAgo } from "../ui";

const steps: JobStatus[] = ["open", "awarded", "funded", "delivered", "settled"];

function Stepper({ status }: { status: JobStatus }) {
  const refunded = status === "refunded";
  const idx = refunded ? 4 : steps.indexOf(status);
  return (
    <ol className="grid grid-cols-5 gap-2">
      {steps.map((s, i) => {
        const done = i < idx || (i === idx && (status === "settled"));
        const cur = i === idx && !done;
        const label = refunded && i === 4 ? "refunded" : s;
        const fail = refunded && i === 4;
        return (
          <li key={s} className="flex flex-col gap-2">
            <div className={`h-1 rounded-full ${fail ? "bg-rose-400" : done ? "bg-teal" : cur ? "bg-violet-500 shadow-[0_0_12px_#8b5cf6]" : "bg-line"}`} />
            <span className={`text-xs capitalize ${fail ? "text-rose-300" : done ? "text-teal" : cur ? "text-white" : "text-muted"}`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-4 py-2 text-sm"><span className="text-muted">{k}</span><span className="min-w-0 truncate text-right">{v}</span></div>
);

export default function JobDetail() {
  const { id } = useParams();
  const [job, setJob] = useState<(Job & { bids: Bid[] }) | null>();
  const load = useCallback(async () => { const j = await getJob(id!).catch(() => undefined); setJob(j ?? null); }, [id]);
  useEffect(() => { load(); }, [load]);
  if (job === undefined) return <div className="space-y-4"><Skeleton className="h-6 w-40" /><Skeleton className="h-24" /><Skeleton className="h-16" /><div className="grid grid-cols-1 gap-6 lg:grid-cols-3"><Skeleton className="h-64 lg:col-span-2" /><Skeleton className="h-64" /></div></div>;
  if (job === null) return <Empty title="Job not found" body="It may have been removed, or the link is wrong." action={<Link className="text-sm text-violet-300" to="/app/jobs">Back to the job board</Link>} />;
  const a = job.attestation;
  return (
    <div className="space-y-6">
      <Link to="/app/jobs" className="text-sm text-muted hover:text-white">← Job board</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2"><KindBadge k={job.kind} /><StatusPill s={job.status} /></div>
          <h1 className="mt-3 text-[26px] font-medium tracking-[-0.03em]">{job.title}</h1>
          <p className="mt-2 text-sm text-muted">{job.description}</p>
        </div>
        <Mono className="text-muted">{job.id}</Mono>
      </div>
      <Card className="p-5"><Stepper status={job.status} /></Card>
      <JobActions job={job} reload={load} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5"><h2 className="text-sm font-medium">Sealed bids</h2><span className="text-xs text-muted">encrypted to buyer's viewing key</span></div>
            <ul className="divide-y divide-line">
              {job.bids.map(b => (
                <li key={b.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="w-36 shrink-0"><div className="text-sm">{agentName(b.sellerAgentId)}</div><div className="text-xs text-muted">{timeAgo(b.createdAt)}</div></div>
                  <span className="cipher min-w-0 flex-1 truncate text-xs"><Lock /> {b.sealedBid}</span>
                  {b.id === job.awardedBidId && <span className="rounded-full bg-teal/10 px-2 py-0.5 text-xs text-teal ring-1 ring-teal-400/25">awarded</span>}
                </li>
              ))}
              {job.bids.length === 0 && <li className="px-5 py-6 text-sm text-muted">No bids yet.</li>}
            </ul>
          </Card>
          <Card className="p-5">
            <h2 className="text-sm font-medium">Spec <span className="font-normal text-muted">· committed hash</span></h2>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-bg p-4 font-mono text-xs text-zinc-300">{JSON.stringify(job.spec, null, 2)}</pre>
            <div className="mt-3 text-xs text-muted">sha256 <Mono className="text-zinc-400">{short(job.specHash, 16, 8)}</Mono></div>
          </Card>
        </div>
        <div className="min-w-0 space-y-6">
          <Card className={`p-5 ${a ? (a.passed ? "border-emerald-500/30" : "border-rose-500/30") : ""}`}>
            <h2 className="text-sm font-medium">Verifier attestation</h2>
            {a ? (
              <div className="mt-3">
                <div className={`text-lg font-semibold ${a.passed ? "text-emerald-300" : "text-rose-300"}`}>{a.passed ? "✓ Passed" : "✕ Failed"}</div>
                <p className="mt-1 text-sm text-zinc-300">{a.report}</p>
                <div className="mt-3 divide-y divide-line border-t border-line">
                  <Row k="Deliverable" v={<Mono>{short(a.deliverableHash, 10, 6)}</Mono>} />
                  <Row k="Verifier" v={<Mono>{short(a.verifierPubKey, 8, 4)}</Mono>} />
                  <Row k="Signature" v={<Mono className="text-violet-300">{short(a.signature, 10, 6)}</Mono>} />
                  <Row k="Verified" v={timeAgo(a.verifiedAt)} />
                </div>
              </div>
            ) : <p className="mt-2 text-sm text-muted">Waiting for delivery. The verifier signs a pass/fail result before escrow releases.</p>}
          </Card>
          <Card className="p-5">
            <h2 className="text-sm font-medium">Escrow</h2>
            <div className="mt-2 divide-y divide-line">
              <Row k="Buyer" v={agentName(job.buyerAgentId)} />
              <Row k="Budget" v={<span className="text-violet-300"><Lock /> sealed</span>} />
              <Row k="Asset" v={<span className="text-violet-300"><Lock /> hidden on-chain</span>} />
              <Row k="Fund tx" v={job.escrowTx ? <Mono>{short(job.escrowTx)}</Mono> : "—"} />
              <Row k={job.status === "refunded" ? "Refund tx" : "Payout tx"} v={job.settlementTx ? <Mono>{short(job.settlementTx)}</Mono> : "—"} />
              <Row k="Fee (1.5%)" v={job.feeTx ? <Mono>{short(job.feeTx)}</Mono> : "—"} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
