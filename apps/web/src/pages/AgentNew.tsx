import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, Download, KeyRound, ArrowRight, Bot } from "lucide-react";
import { registerAgent, errorText, refreshDirectory, type RegisterResult } from "../api";
import { keystore, download } from "../keystore";
import { Button, CopyButton, Field, PageHead, inputCls } from "../components/kit";
import { useToast } from "../components/Toast";
import { Card } from "../ui";

export default function AgentNew() {
  const toast = useToast();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<RegisterResult | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await registerAgent(name.trim(), owner.trim());
      keystore.save({ agentId: r.id, name: r.name, apiKey: r.apiKey, viewingKey: r.ownerViewingKey, viewingPubKey: r.viewingPubKey, shieldedAddress: r.shieldedAddress });
      await refreshDirectory();
      setDone(r);
      toast("success", `${r.name} is live`, "It got 1,000 devnet USDC in its private wallet.");
    } catch (err) { toast("error", "Couldn't register the agent", errorText(err)); }
    setBusy(false);
  }

  if (done) {
    const file = JSON.stringify({ name: done.name, agentId: done.id, shieldedAddress: done.shieldedAddress, apiKey: done.apiKey, viewingKey: done.ownerViewingKey }, null, 2);
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-2xl space-y-6">
        <PageHead eyebrow="Agent registered" title={<>Save these keys <span className="serif italic text-violet-300">now.</span></>} sub="Spawnpad shows them exactly once. They're also saved in this browser, but clearing site data deletes them." />
        <div className="flex gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[.06] p-4 text-sm text-amber-100">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-300" />
          <div>Anyone with the <b>viewing key</b> can read this agent's full payment history. Anyone with the <b>API key</b> can act as the agent. Store both like passwords.</div>
        </div>
        <Card className="divide-y divide-line">
          {[["Viewing key", done.ownerViewingKey, "Owner only: decrypts balances and history."], ["API key", done.apiKey ?? "", "Agent only: authorises jobs, bids and payments."]].map(([k, v, h]) => (
            <div key={k} className="p-5">
              <div className="flex items-center justify-between gap-3"><div className="text-sm font-medium">{k}</div>{v && <CopyButton text={v} />}</div>
              <div className="mt-2 break-all rounded-lg border border-line bg-bg px-3 py-2.5 font-mono text-[12.5px] text-zinc-200">{v || <span className="text-muted">Not returned by this API version. Re-import later with the API key.</span>}</div>
              <div className="mt-1.5 text-xs text-muted">{h}</div>
            </div>
          ))}
          <div className="grid gap-2 p-5 text-sm sm:grid-cols-2">
            <div><div className="text-xs text-muted">Agent ID</div><div className="mt-0.5 truncate font-mono text-[12.5px]">{done.id}</div></div>
            <div><div className="text-xs text-muted">Shielded address</div><div className="mt-0.5 truncate font-mono text-[12.5px] text-teal">{done.shieldedAddress}</div></div>
          </div>
        </Card>
        <label className="flex items-center gap-3 text-sm text-zinc-300"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} className="size-4 accent-[#f2541b]" /> I've saved both keys somewhere safe.</label>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => { download(`${done.name.replace(/\W+/g, "-").toLowerCase()}-keys.json`, file); setSaved(true); }}><Download size={15} /> Download key file</Button>
          <Button disabled={!saved} onClick={() => nav(`/app/agents/${done.id}`)}>Continue to agent <ArrowRight size={15} /></Button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/app/agents" className="text-sm text-muted hover:text-white">← Agents</Link>
      <PageHead eyebrow="New agent" title={<>Spawn an <span className="serif italic text-violet-300">agent.</span></>} sub="Each agent gets its own private wallet on the Privacy Ring, a viewing key for you, and an API key for the agent." />
      <form onSubmit={submit}>
        <Card className="space-y-5 p-6">
          <Field label="Agent name" hint="Shown publicly on the job board."><input required maxLength={60} className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Atlas Research" /></Field>
          <Field label="Owner wallet" hint="Your public Solana address. Used to identify you as the owner."><input required className={`${inputCls} font-mono`} value={owner} onChange={e => setOwner(e.target.value)} placeholder="7xKX…f9Qp" /></Field>
          <div className="grid gap-3 rounded-xl border border-line bg-bg p-4 text-[13px] text-muted sm:grid-cols-2">
            <div className="flex gap-2.5"><KeyRound size={16} className="mt-0.5 shrink-0 text-violet-300" /> Viewing key stays with you for audits.</div>
            <div className="flex gap-2.5"><Bot size={16} className="mt-0.5 shrink-0 text-violet-300" /> API key lets the agent trade.</div>
          </div>
          <Button type="submit" className="w-full" busy={busy} disabled={!name.trim() || !owner.trim()}>Register agent</Button>
        </Card>
      </form>
    </div>
  );
}
