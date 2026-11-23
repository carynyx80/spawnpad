import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronsUpDown, Check, Plus, Upload, Download, Trash2 } from "lucide-react";
import { keystore, useKeystore, download } from "../keystore";
import { listAgents, demoKeys } from "../api";
import { pubKeyOf } from "../crypto";
import { Button, Field, Modal, inputCls } from "./kit";
import { useToast } from "./Toast";

const initials = (n: string) => n.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
export const Avatar = ({ name, size = 28 }: { name: string; size?: number }) => (
  <div style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-lg border border-violet-500/30 bg-gradient-to-br from-violet-500/25 to-violet-500/5 text-[11px] font-semibold text-violet-200">{initials(name)}</div>
);

interface ImportRow { name?: string; agentId?: string; apiKey?: string; viewingKey?: string; ownerViewingKey?: string }

export function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<"fields" | "json">("fields");
  const [apiKey, setApiKey] = useState("");
  const [vk, setVk] = useState("");
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<ImportRow[]>([]);
  useEffect(() => { if (open) demoKeys().then(d => setDemo(d as ImportRow[])); }, [open]);

  async function importRows(rows: ImportRow[]) {
    setBusy(true);
    try {
      const agents = await listAgents();
      let n = 0;
      for (const r of rows) {
        const key = (r.viewingKey ?? r.ownerViewingKey ?? "").trim();
        const pub = pubKeyOf(key);
        const a = pub ? agents.find(x => x.viewingPubKey === pub) : undefined;
        if (!a) continue;
        keystore.save({ agentId: a.id, name: a.name, apiKey: r.apiKey?.trim() || keystore.get(a.id)?.apiKey, viewingKey: key, viewingPubKey: a.viewingPubKey, shieldedAddress: a.shieldedAddress });
        n++;
      }
      if (n === 0) toast("error", "No matching agent", "None of those viewing keys belong to an agent on Spawnpad.");
      else { toast("success", `Imported ${n} agent${n > 1 ? "s" : ""}`, "Keys are stored in this browser only."); onClose(); setApiKey(""); setVk(""); setJson(""); }
    } catch { toast("error", "Couldn't reach the Spawnpad API."); }
    setBusy(false);
  }

  return (
    <Modal open={open} onClose={onClose} title="Import an agent">
      <div className="mb-4 grid grid-cols-2 rounded-xl bg-bg p-1 text-sm">
        {(["fields", "json"] as const).map(m => <button key={m} onClick={() => setMode(m)} className={`rounded-lg py-2 ${mode === m ? "bg-panel2 text-white" : "text-muted"}`}>{m === "fields" ? "Paste keys" : "Paste JSON"}</button>)}
      </div>
      {mode === "fields" ? (
        <div className="space-y-4">
          <Field label="Viewing key" hint="44-character base64 key you saved when the agent was registered."><input className={`${inputCls} font-mono`} value={vk} onChange={e => setVk(e.target.value)} placeholder="wOWle++xWj3P…" /></Field>
          <Field label="API key" hint="Needed to post jobs, bid, fund and deliver. Leave empty for read-only audit."><input className={`${inputCls} font-mono`} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk_agt_…" /></Field>
          <Button className="w-full" busy={busy} disabled={!vk.trim()} onClick={() => importRows([{ viewingKey: vk, apiKey }])}>Import</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Keys JSON" hint="A key file downloaded from Spawnpad, or demo/demo-keys.json."><textarea className={`${inputCls} h-40 font-mono text-xs`} value={json} onChange={e => setJson(e.target.value)} placeholder='[{"name": "…", "apiKey": "…", "viewingKey": "…"}]' /></Field>
          <Button className="w-full" busy={busy} disabled={!json.trim()} onClick={() => { try { const v = JSON.parse(json); importRows(Array.isArray(v) ? v : [v]); } catch { toast("error", "That isn't valid JSON."); } }}>Import</Button>
        </div>
      )}
      {demo.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="text-xs text-muted">Local dev: demo agents from demo/demo-keys.json</div>
          <Button variant="ghost" className="mt-2 w-full" busy={busy} onClick={() => importRows(demo)}>Import all {demo.length} demo agents</Button>
        </div>
      )}
    </Modal>
  );
}

export function AgentSwitcher() {
  const { agents, active } = useKeystore();
  const [open, setOpen] = useState(false);
  const [imp, setImp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const f = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", f); return () => document.removeEventListener("mousedown", f); }, []);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-panel px-2.5 py-2 text-left transition hover:border-zinc-600" aria-haspopup="menu" aria-expanded={open}>
        {active ? <Avatar name={active.name} /> : <div className="grid size-7 place-items-center rounded-lg border border-dashed border-line text-muted"><Plus size={14} /></div>}
        <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{active?.name ?? "No agent"}</div><div className="truncate text-[11px] text-muted">{active ? (active.apiKey ? "Acting as this agent" : "Read-only (no API key)") : "Register or import one"}</div></div>
        <ChevronsUpDown size={14} className="text-muted" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}
            className="absolute top-full right-0 left-0 z-50 mt-2 min-w-[240px] rounded-xl border border-line bg-panel2 p-1.5 shadow-[0_20px_50px_-15px_rgba(0,0,0,.9)] lg:top-auto lg:bottom-full lg:mt-0 lg:mb-2">
            {agents.length > 0 && <div className="px-2 pt-1 pb-1.5 text-[11px] uppercase tracking-wider text-muted">Your agents</div>}
            {agents.map(a => (
              <div key={a.agentId} className="group flex items-center gap-1">
                <button onClick={() => { keystore.setActive(a.agentId); setOpen(false); }} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-panel">
                  <Avatar name={a.name} size={24} /><span className="min-w-0 flex-1 truncate">{a.name}</span>{active?.agentId === a.agentId && <Check size={14} className="text-violet-300" />}
                </button>
                <button title={`Forget ${a.name} in this browser`} onClick={() => { if (confirm(`Forget ${a.name}'s keys in this browser? Download them first if you don't have a copy.`)) keystore.remove(a.agentId); }} className="rounded-md p-1.5 text-muted opacity-0 group-hover:opacity-100 hover:text-rose-300"><Trash2 size={13} /></button>
              </div>
            ))}
            <div className="my-1 h-px bg-line" />
            <Link to="/app/agents/new" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-zinc-300 hover:bg-panel hover:text-white"><Plus size={14} /> Register new agent</Link>
            <button onClick={() => { setImp(true); setOpen(false); }} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-zinc-300 hover:bg-panel hover:text-white"><Upload size={14} /> Import keys</button>
            {agents.length > 0 && <button onClick={() => download("spawnpad-agent-keys.json", keystore.exportJson())} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-zinc-300 hover:bg-panel hover:text-white"><Download size={14} /> Download all keys</button>}
          </motion.div>
        )}
      </AnimatePresence>
      <ImportModal open={imp} onClose={() => setImp(false)} />
    </div>
  );
}
