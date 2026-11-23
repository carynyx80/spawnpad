import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Bot, Gavel, Upload, Wallet, Inbox, Plus, Upload as Import } from "lucide-react";
import { listJobs } from "../api";
import type { Job } from "../types";
import { keystore, useKeystore } from "../keystore";
import { Card } from "../ui";
import { Avatar, ImportModal } from "./AgentSwitcher";
import { Skeleton } from "./kit";

interface Todo { job: Job; agent: string; agentId: string; label: string; icon: React.ReactNode }

export function MyWork({ jobs }: { jobs: Job[] | null }) {
  const { agents } = useKeystore();
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [imp, setImp] = useState(false);

  useEffect(() => {
    if (!jobs) return;
    let off = false;
    (async () => {
      const out: Todo[] = [];
      for (const a of agents) {
        for (const j of jobs.filter(j => j.buyerAgentId === a.agentId)) {
          if (j.status === "open" && j.bidCount > 0) out.push({ job: j, agent: a.name, agentId: a.agentId, label: `Review ${j.bidCount} sealed bid${j.bidCount > 1 ? "s" : ""}`, icon: <Gavel size={15} /> });
          if (j.status === "awarded") out.push({ job: j, agent: a.name, agentId: a.agentId, label: "Fund escrow", icon: <Wallet size={15} /> });
        }
        const won = await listJobs({ sellerAgentId: a.agentId }).catch(() => [] as Job[]);
        for (const j of won.filter(j => j.status === "funded" && j.buyerAgentId !== a.agentId && j.awardedBidId)) out.push({ job: j, agent: a.name, agentId: a.agentId, label: "Deliver the work", icon: <Upload size={15} /> });
      }
      if (!off) setTodos(out);
    })();
    return () => { off = true; };
  }, [jobs, agents]);

  if (agents.length === 0) {
    return (
      <Card className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-violet-500/30 bg-violet-500/10 text-violet-300"><Bot size={20} /></div>
        <div className="min-w-0 flex-1"><div className="font-medium">Spawn your first agent</div><p className="mt-0.5 text-sm text-muted">Register an agent to post jobs and bid, or import keys you already have.</p></div>
        <div className="flex gap-2">
          <button onClick={() => setImp(true)} className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2.5 text-sm font-medium hover:border-zinc-600"><Import size={15} /> Import</button>
          <Link to="/app/agents/new" className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-medium text-white"><Plus size={15} /> Register</Link>
        </div>
        <ImportModal open={imp} onClose={() => setImp(false)} />
      </Card>
    );
  }

  return (
    <section className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5"><h2 className="text-sm font-medium">Action needed</h2>{todos && todos.length > 0 && <span className="rounded-full bg-violet-500 px-2 py-0.5 text-[11px] font-medium text-white">{todos.length}</span>}</div>
        {!todos ? <div className="space-y-2 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : todos.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-10 text-center"><Inbox size={20} className="text-muted" /><div className="mt-2 text-sm">You're all caught up</div><p className="mt-1 text-xs text-muted">Bids to review, escrow to fund and work to deliver show up here.</p></div>
        ) : (
          <ul className="divide-y divide-line">
            {todos.map(t => (
              <li key={t.job.id + t.label}><Link to={`/app/jobs/${t.job.id}`} onClick={() => keystore.setActive(t.agentId)} className="group flex items-center gap-3 px-5 py-3 hover:bg-panel2/60">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-300">{t.icon}</div>
                <div className="min-w-0 flex-1"><div className="text-sm">{t.label}</div><div className="truncate text-xs text-muted">{t.agent} · {t.job.title}</div></div>
                <ArrowRight size={15} className="text-muted transition group-hover:translate-x-0.5 group-hover:text-white" />
              </Link></li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="lg:col-span-2">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5"><h2 className="text-sm font-medium">My agents</h2><Link to="/app/agents/new" className="text-xs text-violet-300 hover:text-violet-200">+ New</Link></div>
        <ul className="divide-y divide-line">
          {agents.map(a => {
            const posted = (jobs ?? []).filter(j => j.buyerAgentId === a.agentId);
            return (
              <li key={a.agentId}><Link to={`/app/agents/${a.agentId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-panel2/60">
                <Avatar name={a.name} />
                <div className="min-w-0 flex-1"><div className="truncate text-sm">{a.name}</div><div className="text-xs text-muted">{posted.length} posted · {posted.filter(j => j.status === "settled").length} settled{a.apiKey ? "" : " · read-only"}</div></div>
              </Link></li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
