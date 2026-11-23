import type { JobStatus, JobKind } from "./types";
export { nameFor, agentName } from "./api";

export const short = (s: string, a = 6, b = 4) => s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s;
export const timeAgo = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  const f = Math.abs(d);
  const v = f < 60 ? `${Math.round(f)}s` : f < 3600 ? `${Math.round(f / 60)}m` : f < 86400 ? `${Math.round(f / 3600)}h` : `${Math.round(f / 86400)}d`;
  return d >= 0 ? `${v} ago` : `in ${v}`;
};
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      {/* Sealed spark: a keyhole (privacy) with a spark inside (a new agent). */}
      <rect x="1" y="1" width="30" height="30" rx="9" fill="#ff6a3d" />
      <circle cx="16" cy="13.2" r="5.4" fill="#0b0b0e" />
      <path d="M13.4 16.6 12 25.2h8l-1.4-8.6z" fill="#0b0b0e" />
      <path d="M16 9.9l.95 2.35 2.35.95-2.35.95-.95 2.35-.95-2.35-2.35-.95 2.35-.95z" fill="#ff6a3d" />
    </svg>
  );
}

const statusStyle: Record<JobStatus, string> = {
  open: "bg-teal-400/10 text-teal-300 ring-teal-400/25",
  awarded: "bg-sky-400/10 text-sky-300 ring-sky-400/25",
  funded: "bg-violet-400/10 text-violet-300 ring-violet-400/30",
  delivered: "bg-amber-400/10 text-amber-300 ring-amber-400/25",
  settled: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25",
  refunded: "bg-rose-400/10 text-rose-300 ring-rose-400/25",
  cancelled: "bg-zinc-400/10 text-zinc-400 ring-zinc-400/25",
};
export const StatusPill = ({ s }: { s: JobStatus }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset capitalize ${statusStyle[s]}`}>
    <span className="size-1.5 rounded-full bg-current" />{s}
  </span>
);
export const KindBadge = ({ k }: { k: JobKind }) => (
  <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel2 px-2 py-0.5 text-xs text-zinc-300">
    {k === "data_delivery" ? <><span className="text-teal-300">◆</span> Data delivery</> : <><span className="text-violet-300">❯_</span> Code passes tests</>}
  </span>
);
export const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-xl border border-line bg-panel ${className}`}>{children}</div>
);
export const Mono = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <span className={`font-mono text-[12.5px] ${className}`}>{children}</span>
);
export const Lock = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="inline -mt-0.5"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);
