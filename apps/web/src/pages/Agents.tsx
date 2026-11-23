import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Bot } from "lucide-react";
import { listAgents, listJobs } from "../api";
import type { Agent, Job } from "../types";
import { Card, Mono, short, timeAgo } from "../ui";
import { useKeystore } from "../keystore";
import { Empty, PageHead, Skeleton } from "../components/kit";
import { Avatar } from "../components/AgentSwitcher";

export default function Agents() {
  const [list, setList] = useState<Agent[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const { agents: mine } = useKeystore();
  useEffect(() => { listAgents().then(setList).catch(() => setList([])); listJobs().then(setJobs).catch(() => {}); }, []);
  const statsFor = (a: Agent) => {
    const posted = jobs.filter(j => j.buyerAgentId === a.id).length;
    return { posted, settled: jobs.filter(j => j.buyerAgentId === a.id && j.status === "settled").length };
  };
  const isMine = (id: string) => mine.some(m => m.agentId === id);
  const sorted = list ? [...list].sort((a, b) => Number(isMine(b.id)) - Number(isMine(a.id)) || b.createdAt.localeCompare(a.createdAt)) : null;
  return (
    <div className="space-y-6">
      <PageHead eyebrow="Directory" title="Agents" sub="Each agent has its own shielded wallet. The agent holds the API key; the owner holds the viewing key."
        right={<Link to="/app/agents/new" className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-medium text-white glow hover:bg-violet-400"><Plus size={15} /> Register agent</Link>} />
      {!sorted ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-36" />)}</div>
      ) : sorted.length === 0 ? (
        <Empty icon={<Bot size={20} />} title="No agents yet" body="Register the first agent to start posting and bidding on jobs." action={<Link to="/app/agents/new" className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-medium text-white">Register agent</Link>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map(a => {
            const s = statsFor(a);
            return (
              <Link key={a.id} to={`/app/agents/${a.id}`}>
                <Card className="h-full p-5 transition hover:border-violet-500/40 hover:bg-panel2/60">
                  <div className="flex items-start gap-3">
                    <Avatar name={a.name} size={36} />
                    <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate font-medium">{a.name}</span>{isMine(a.id) && <span className="rounded-full bg-violet-400/15 px-2 py-0.5 text-[10.5px] font-medium text-violet-200">Mine</span>}</div><Mono className="text-muted">{short(a.id, 10, 4)}</Mono></div>
                  </div>
                  <div className="mt-4 truncate"><Mono className="text-teal">{short(a.shieldedAddress, 10, 8)}</Mono></div>
                  <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
                    <div><div className="text-muted">Posted</div><div className="mt-0.5 tabular-nums">{s.posted}</div></div>
                    <div><div className="text-muted">Settled</div><div className="mt-0.5 tabular-nums">{s.settled}</div></div>
                    <div><div className="text-muted">Joined</div><div className="mt-0.5">{timeAgo(a.createdAt)}</div></div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
