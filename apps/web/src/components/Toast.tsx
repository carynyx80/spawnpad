import { createContext, useCallback, useContext, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";

type Kind = "success" | "error" | "info";
interface T { id: number; kind: Kind; title: string; body?: string }
const Ctx = createContext<(kind: Kind, title: string, body?: string) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((kind: Kind, title: string, body?: string) => {
    const id = Date.now() + Math.random();
    setItems(xs => [...xs, { id, kind, title, body }]);
    setTimeout(() => setItems(xs => xs.filter(x => x.id !== id)), kind === "error" ? 7000 : 4500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6" aria-live="polite">
        <AnimatePresence>
          {items.map(t => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.2 }}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-line bg-panel2/95 px-4 py-3 shadow-[0_20px_50px_-15px_rgba(0,0,0,.8)] backdrop-blur sm:w-96">
              {t.kind === "success" ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-teal" /> : t.kind === "error" ? <AlertCircle size={18} className="mt-0.5 shrink-0 text-rose-400" /> : <Info size={18} className="mt-0.5 shrink-0 text-violet-300" />}
              <div className="min-w-0"><div className="text-sm font-medium">{t.title}</div>{t.body && <div className="mt-0.5 text-[13px] text-muted">{t.body}</div>}</div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
