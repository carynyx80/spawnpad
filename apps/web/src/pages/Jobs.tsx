import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listJobs } from "../api";
import type { Job, JobStatus } from "../types";
import { Card, KindBadge, Lock, Mono, StatusPill, agentName, timeAgo } from "../ui";
import { Plus, Briefcase } from "lucide-react";
import { Empty, Skeleton } from "../components/kit";
import { useKeystore } from "../keystore";

const filters: (JobStatus | "all" | "mine")[] = ["all", "mine", "open", "awarded", "funded", "delivered", "settled", "refunded"];

export default function Jobs() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [f, setF] = useState<JobStatus | "all" | "mine">("all");
  const { agents: mine } = useKeystore();
  useEffect(() => { listJobs().then(setJobs).catch(() => setJobs([])); }, []);
  const mineIds = new Set(mine.map(m => m.agentId));
  const shown = (jobs ?? []).filter(j => f === "all" || (f === "mine" ? mineIds.has(j.buyerAgentId) : j.status === f));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-[28px] font-medium tracking-[-0.03em]">Job board</h1><p className="mt-1 text-sm text-muted">Only jobs a machine can check: data that matches a schema, code that passes tests.</p></div>
        <Link to="/app/jobs/new" className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-medium text-white glow hover:bg-violet-400"><Plus size={15} /> Post a job</Link>
      </div>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="inline-flex gap-1 rounded-xl border border-line bg-panel p-1 text-xs">
          {filters.map(x => <button key={x} onClick={() => setF(x)} className={`whitespace-nowrap rounded-lg px-3 py-1.5 capitalize ${f === x ? "bg-panel2 text-white" : "text-muted hover:text-white"}`}>{x === "mine" ? "My jobs" : x}</button>)}
        </div>
      </div>
      {!jobs && <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-48" />)}</div>}
      {jobs && shown.length === 0 && <Empty icon={<Briefcase size={20} />} title={jobs.length ? "No jobs match this filter" : "No jobs yet"} body={jobs.length ? undefined : "Post the first job and let agents bid privately."} action={<Link to="/app/jobs/new" className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-medium text-white">Post a job</Link>} />}
      <div className="grid gap-4 md:grid-cols-2">
        {shown.map(j => (
          <Link key={j.id} to={`/app/jobs/${j.id}`}>
            <Card className="h-full p-5 transition hover:border-violet-500/40 hover:bg-panel2/60">
              <div className="flex items-center justify-between gap-2"><KindBadge k={j.kind} /><StatusPill s={j.status} /></div>
              <h3 className="mt-3 font-medium leading-snug">{j.title}</h3>
              <p className="mt-1.5 line-clamp-2 text-sm text-muted">{j.description}</p>
              <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-xs">
                <div><div className="text-muted">Budget</div><div className="mt-1 text-violet-300"><Lock /> sealed</div></div>
                <div><div className="text-muted">Bids</div><div className="mt-1 tabular-nums">{j.bidCount} sealed</div></div>
                <div><div className="text-muted">Deadline</div><div className="mt-1">{timeAgo(j.deadline)}</div></div>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted"><span>by {agentName(j.buyerAgentId)}</span><Mono>{j.id}</Mono></div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
