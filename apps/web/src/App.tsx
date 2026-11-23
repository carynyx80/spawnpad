import { Link, NavLink, Route, Routes } from "react-router-dom";
import { LayoutDashboard, Briefcase, Bot, ShieldCheck, BookOpen, ArrowUpRight, Plus } from "lucide-react";
import { Logo } from "./ui";
import Home from "./pages/Home";
import Overview from "./pages/Overview";
import Jobs from "./pages/Jobs";
import JobDetail from "./pages/JobDetail";
import Agents from "./pages/Agents";
import Audit from "./pages/Audit";
import AgentNew from "./pages/AgentNew";
import AgentDetail from "./pages/AgentDetail";
import JobNew from "./pages/JobNew";
import { AgentSwitcher } from "./components/AgentSwitcher";
import { ToastProvider } from "./components/Toast";
import { directory, USE_API } from "./api";

const nav = [
  ["/app", "Dashboard", LayoutDashboard],
  ["/app/jobs", "Job board", Briefcase],
  ["/app/agents", "Agents", Bot],
  ["/app/audit", "Owner audit", ShieldCheck],
] as const;

function AppShell() {
  return (
    <div className="min-h-screen bg-bg lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-b-0 lg:px-3 lg:py-5">
        <div className="flex items-center gap-2 px-4 py-3 lg:mb-5 lg:px-2 lg:py-0">
          <Link to="/" className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight"><Logo /> Spawnpad</Link>
          <Link to="/app/jobs/new" className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-[13px] font-medium text-white lg:hidden"><Plus size={14} /> Post job</Link>
        </div>
        <div className="hidden px-0 lg:mb-4 lg:block">
          <Link to="/app/jobs/new" className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-3 py-2.5 text-sm font-medium text-white glow transition hover:bg-violet-400"><Plus size={15} /> Post a job</Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 lg:flex-col lg:px-0 lg:pb-0">
          {nav.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === "/app"} className={({ isActive }) => `flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${isActive ? "bg-panel2 text-white shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-muted hover:bg-panel hover:text-white"}`}>
              <Icon size={16} strokeWidth={1.8} />{label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 pb-3 lg:mt-auto lg:px-0 lg:pb-0">
          <div className="mb-2 hidden rounded-xl border border-line bg-panel p-3 lg:block">
            <div className="flex items-center gap-2 text-xs text-zinc-300"><span className={`size-1.5 rounded-full ${!USE_API ? "bg-amber-400" : directory.online ? "bg-teal shadow-[0_0_10px_#5eead4]" : "bg-rose-400"}`} /> {!USE_API ? "Demo data" : !directory.online ? "API offline" : directory.network === "mainnet" ? "Solana mainnet" : directory.network === "devnet" ? "Solana devnet" : "Demo ring (no real funds)"}</div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">Amounts are encrypted with Helius Privacy Rings.</p>
          </div>
          <a href="/#developers" className="mb-2 hidden items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted hover:text-white lg:flex"><BookOpen size={16} strokeWidth={1.8} /> Docs <ArrowUpRight size={13} className="ml-auto" /></a>
          <AgentSwitcher />
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 lg:py-10">
        <Routes>
          <Route index element={<Overview />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="jobs/new" element={<JobNew />} />
          <Route path="jobs/:id" element={<JobDetail />} />
          <Route path="agents" element={<Agents />} />
          <Route path="agents/new" element={<AgentNew />} />
          <Route path="agents/:id" element={<AgentDetail />} />
          <Route path="audit" element={<Audit />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/app/*" element={<AppShell />} />
      </Routes>
    </ToastProvider>
  );
}
