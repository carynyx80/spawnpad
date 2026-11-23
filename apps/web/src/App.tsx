import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { LayoutDashboard, Briefcase, Bot, ShieldCheck, BookOpen, ArrowUpRight, Plus, PanelLeftClose, PanelLeftOpen, Menu } from "lucide-react";
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
import { WalletProviders } from "./wallet/WalletProviders";
import { ConnectWallet } from "./wallet/ConnectWallet";
import { directory, USE_API } from "./api";

const nav = [
  ["/app", "Dashboard", LayoutDashboard],
  ["/app/jobs", "Job board", Briefcase],
  ["/app/agents", "Agents", Bot],
  ["/app/audit", "Owner audit", ShieldCheck],
] as const;

const DRAWER_W = 264;
const PREF_KEY = "spawnpad.drawer.open";
const desktopQuery = "(min-width: 1024px)";
const isDesktop = () => typeof window !== "undefined" && window.matchMedia(desktopQuery).matches;
const readPref = () => { try { return localStorage.getItem(PREF_KEY) !== "0"; } catch { return true; } };

function useDesktop() {
  const [d, setD] = useState(isDesktop);
  useEffect(() => {
    const m = window.matchMedia(desktopQuery);
    const f = () => setD(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return d;
}

function DrawerContents({ onNavigate, onClose }: { onNavigate: () => void; onClose: () => void }) {
  const networkLabel = !USE_API ? "Demo data" : !directory.online ? "API offline" : directory.network === "mainnet" ? "Solana mainnet" : directory.network === "devnet" ? "Solana devnet" : "Demo ring (no real funds)";
  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 py-4">
      <div className="mb-5 flex items-center gap-2 px-2">
        <Link to="/" onClick={onNavigate} className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight"><Logo /> Spawnpad</Link>
        <button onClick={onClose} className="ml-auto grid size-8 place-items-center rounded-lg text-muted hover:bg-panel2 hover:text-white" aria-label="Close menu"><PanelLeftClose size={17} /></button>
      </div>
      <Link to="/app/jobs/new" onClick={onNavigate} className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-3 py-2.5 text-sm font-medium text-white glow transition hover:bg-violet-400"><Plus size={15} /> Post a job</Link>
      <nav className="flex flex-col gap-1">
        {nav.map(([to, label, Icon], i) => (
          <motion.div key={to} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i, duration: 0.25 }}>
            <NavLink to={to} end={to === "/app"} onClick={onNavigate} className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${isActive ? "bg-panel2 text-white shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-muted hover:bg-panel hover:text-white"}`}>
              <Icon size={16} strokeWidth={1.8} />{label}
            </NavLink>
          </motion.div>
        ))}
      </nav>
      <div className="mt-auto space-y-2 pt-4">
        <div className="rounded-xl border border-line bg-panel p-3">
          <div className="flex items-center gap-2 text-xs text-zinc-300"><span className={`size-1.5 rounded-full ${!USE_API ? "bg-amber-400" : directory.online ? "bg-teal shadow-[0_0_10px_#5eead4]" : "bg-rose-400"}`} /> {networkLabel}</div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">Powered by Helius Privacy Rings.</p>
        </div>
        <a href="/#developers" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted hover:text-white"><BookOpen size={16} strokeWidth={1.8} /> Docs <ArrowUpRight size={13} className="ml-auto" /></a>
        <AgentSwitcher />
        <ConnectWallet />
      </div>
    </div>
  );
}

function AppShell() {
  const desktop = useDesktop();
  const location = useLocation();
  const [open, setOpen] = useState(() => (isDesktop() ? readPref() : false));

  // Desktop remembers the drawer state; phones start closed and close after navigating.
  useEffect(() => { setOpen(desktop ? readPref() : false); }, [desktop]);
  useEffect(() => { if (!desktop) setOpen(false); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!desktop) return;
    try { localStorage.setItem(PREF_KEY, open ? "1" : "0"); } catch { /* per-viewer convenience only */ }
  }, [open, desktop]);
  useEffect(() => {
    if (desktop || !open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [open, desktop]);

  const close = () => setOpen(false);
  const onNavigate = () => { if (!desktop) setOpen(false); };
  const spring = { type: "spring" as const, stiffness: 380, damping: 38 };

  return (
    <div className="min-h-screen bg-bg">
      <AnimatePresence>
        {open && !desktop && (
          <motion.div key="scrim" className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} aria-hidden />
        )}
      </AnimatePresence>
      <motion.aside
        className="fixed top-0 left-0 z-50 h-dvh border-r border-line bg-bg/95 backdrop-blur-xl"
        style={{ width: DRAWER_W }}
        initial={false}
        animate={{ x: open ? 0 : -DRAWER_W - 8 }}
        transition={spring}
        aria-hidden={!open}
        {...(!open ? { inert: "" as unknown as boolean } : {})}
      >
        <DrawerContents onNavigate={onNavigate} onClose={close} />
      </motion.aside>

      <motion.div initial={false} animate={{ paddingLeft: desktop && open ? DRAWER_W : 0 }} transition={spring}>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line/70 bg-bg/80 px-3 backdrop-blur sm:px-5">
          <AnimatePresence initial={false}>
            {!open && (
              <motion.div key="bar" className="flex items-center gap-2" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18 }}>
                <button onClick={() => setOpen(true)} className="grid size-9 place-items-center rounded-lg text-zinc-300 hover:bg-panel2 hover:text-white" aria-label="Open menu">
                  {desktop ? <PanelLeftOpen size={18} /> : <Menu size={19} />}
                </button>
                <Link to="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"><Logo size={24} /> <span className="hidden sm:inline">Spawnpad</span></Link>
              </motion.div>
            )}
          </AnimatePresence>
          <Link to="/app/jobs/new" className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-violet-400"><Plus size={14} /> Post job</Link>
        </header>
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
      </motion.div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <WalletProviders>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/app/*" element={<AppShell />} />
        </Routes>
      </WalletProviders>
    </ToastProvider>
  );
}
