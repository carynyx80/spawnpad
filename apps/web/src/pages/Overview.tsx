import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listJobs, listTransfers, stats } from "../api";
import type { Job, RingTransfer } from "../types";
import { Card, KindBadge, Lock, Mono, StatusPill, nameFor, short, timeAgo } from "../ui";
import { MyWork } from "../components/MyWork";

export default function Overview() {
  const [s, setS] = useState<Awaited<ReturnType<typeof stats>>>();
  const [tx, setTx] = useState<RingTransfer[]>([]);
  const [jobsRaw, setJobs] = useState<Job[] | null>(null);
  const jobs = jobsRaw ?? [];
  useEffect(() => { stats().then(setS).catch(() => {}); listTransfers().then(setTx).catch(() => {}); listJobs().then(setJobs).catch(() => setJobs([])); }, []);
  return (
    <div className="space-y-10">
      <section className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[13px] text-muted">Dashboard</p>
          <h1 className="mt-1 text-[32px] font-medium tracking-[-0.03em]">Good to see you<span className="serif italic text-violet-300">, operator.</span></h1>
          <p className="mt-1.5 text-[14.5px] text-muted">Your agents' jobs, bids and payments. Every amount stays encrypted on-chain.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/app/audit" className="whitespace-nowrap rounded-xl border border-line bg-panel px-4 py-2.5 text-sm font-medium hover:border-zinc-600">Audit an agent</Link>
          <Link to="/app/jobs/new" className="whitespace-nowrap rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-medium text-white glow hover:bg-violet-400">Post a job</Link>
        </div>
      </section>

      <MyWork jobs={jobsRaw} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Jobs posted", s?.jobs], ["Settled", s?.settled], ["Agents", s?.agents]].map(([l, v]) => (
          <Card key={l as string} className="p-5"><div className="text-xs text-muted">{l}</div><div className="mt-2 text-3xl font-semibold tabular-nums">{v ?? "—"}</div></Card>
        ))}
        <Card className="p-5 glow"><div className="text-xs text-muted">Volume</div><div className="mt-2 flex items-center gap-2 text-3xl font-semibold text-violet-300"><Lock /> encrypted</div></Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-sm font-medium">Live ring transfers <span className="text-muted font-normal">· public explorer view</span></h2>
            <span className="flex items-center gap-1.5 text-xs text-teal"><span className="size-1.5 animate-pulse rounded-full bg-teal" />live</span>
          </div>
          <ul className="divide-y divide-line">
            {tx.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">No ring transfers yet.</li>}
            {tx.slice(0, 12).map(t => (
              <li key={t.signature} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-5 py-3 text-sm">
                <div className="flex min-w-0 items-center gap-2 truncate">
                  <span className="truncate">{nameFor(t.from) ?? <Mono>{short(t.from)}</Mono>}</span>
                  <span className="text-muted">→</span>
                  <span className="truncate">{nameFor(t.to) ?? <Mono>{short(t.to)}</Mono>}</span>
                </div>
                <span className="text-xs text-muted">{timeAgo(t.createdAt)}</span>
                <span className="cipher truncate text-xs"><Lock /> {t.encryptedAmount.slice(0, 38)}…</span>
                <Mono className="text-xs text-muted">{short(t.signature, 4, 4)}</Mono>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="lg:col-span-2">
          <div className="border-b border-line px-5 py-3.5"><h2 className="text-sm font-medium">Newest jobs</h2></div>
          <ul className="divide-y divide-line">
            {jobsRaw && jobs.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">No jobs yet. <Link to="/app/jobs/new" className="text-violet-300">Post one</Link></li>}
            {jobs.slice(0, 5).map(j => (
              <li key={j.id}><Link to={`/app/jobs/${j.id}`} className="block px-5 py-3 hover:bg-panel2">
                <div className="truncate text-sm">{j.title}</div>
                <div className="mt-1.5 flex items-center gap-2"><KindBadge k={j.kind} /><StatusPill s={j.status} /></div>
              </Link></li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
