import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Loader2, X } from "lucide-react";

export const inputCls = "w-full min-w-0 rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm outline-none transition placeholder:text-zinc-600 focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/15";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] text-zinc-300">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "white"; busy?: boolean };
export function Button({ variant = "primary", busy, className = "", children, disabled, ...rest }: BtnProps) {
  const v = {
    primary: "bg-violet-500 text-white hover:bg-violet-400 glow",
    white: "bg-white text-black hover:bg-zinc-200",
    ghost: "border border-line bg-panel text-zinc-200 hover:border-zinc-600 hover:text-white",
    danger: "border border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20",
  }[variant];
  return (
    <button {...rest} disabled={disabled || busy} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}>
      {busy && <Loader2 size={15} className="animate-spin" />}{children}
    </button>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* clipboard blocked */ } }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-xs text-zinc-300 hover:text-white">
      {ok ? <Check size={13} className="text-teal" /> : <Copy size={13} />}{ok ? "Copied" : label}
    </button>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [open, onClose]);
  // Portal to <body> so dialogs opened from the sliding drawer (a transformed ancestor) still cover the whole screen.
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div role="dialog" aria-modal="true" aria-label={title} initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-panel p-5 shadow-2xl sm:rounded-2xl sm:p-6 ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}>
            <div className="mb-4 flex items-center justify-between gap-4"><h2 className="text-lg font-medium tracking-tight">{title}</h2><button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-panel2 hover:text-white"><X size={18} /></button></div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export const Skeleton = ({ className = "" }: { className?: string }) => <div className={`animate-pulse rounded-lg bg-panel2 ${className}`} />;

export function Empty({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
      {icon && <div className="mb-3 grid size-11 place-items-center rounded-xl border border-line bg-panel2 text-zinc-400">{icon}</div>}
      <div className="font-medium">{title}</div>
      {body && <p className="mt-1.5 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export const PageHead = ({ eyebrow, title, sub, right }: { eyebrow?: string; title: React.ReactNode; sub?: string; right?: React.ReactNode }) => (
  <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0">{eyebrow && <p className="text-[13px] text-muted">{eyebrow}</p>}<h1 className="mt-1 text-[28px] font-medium tracking-[-0.03em]">{title}</h1>{sub && <p className="mt-1.5 text-[14.5px] text-muted">{sub}</p>}</div>
    {right && <div className="flex shrink-0 flex-wrap gap-2">{right}</div>}
  </div>
);
