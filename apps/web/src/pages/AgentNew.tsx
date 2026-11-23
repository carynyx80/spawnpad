import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, Download, KeyRound, ArrowRight, Bot, BadgeCheck, Wallet } from "lucide-react";
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
  const [done, setDone] = useState<(RegisterResult & { ownerVerified?: boolean }) | null>(null);
  const [saved, setSaved] = useState(false);
  const { publicKey, signMessage, connected } = useWallet();
  const connectedAddr = publicKey?.toBase58();
  const [verify, setVerify] = useState(true);
  // Prefill the owner field with the connected wallet (still editable).
  useEffect(() => { if (connectedAddr && !owner) setOwner(connectedAddr); }, [connectedAddr]); // eslint-disable-line react-hooks/exhaustive-deps
  const canVerify = !!connected && !!connectedAddr && owner.trim() === connectedAddr && !!signMessage;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    let proof: { ownerMessage: string; ownerSignature: string } | undefined;
    if (canVerify && verify && signMessage) {
      const ownerMessage = `Spawnpad: register agent "${name.trim()}" for owner ${owner.trim()} at ${new Date().toISOString()}`;
      try {
        const sig = await signMessage(new TextEncoder().encode(ownerMessage));
        let bin = ""; sig.forEach(b => { bin += String.fromCharCode(b); });
        proof = { ownerMessage, ownerSignature: btoa(bin) };
      } catch {
        toast("error", "Signature cancelled", "Sign the message to verify ownership, or untick the verify option.");
        setBusy(false);
        return;
      }
    }
    try {
      const r = await registerAgent(name.trim(), owner.trim(), proof);
      keystore.save({ agentId: r.id, name: r.name, apiKey: r.apiKey, viewingKey: r.ownerViewingKey, viewingPubKey: r.viewingPubKey, shieldedAddress: r.shieldedAddress });
      await refreshDirectory();
      setDone(r);
      toast("success", `${r.name} is live`, r.ownerVerified ? "Ownership verified with your wallet." : "Its private wallet is ready.");
    } catch (err) { toast("error", "Couldn't register the agent", errorText(err)); }
    setBusy(false);
  }

  if (done) {
    const file = JSON.stringify({ name: done.name, agentId: done.id, shieldedAddress: done.shieldedAddress, apiKey: done.apiKey, viewingKey: done.ownerViewingKey }, null, 2);
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-2xl space-y-6">
        <PageHead eyebrow="Agent registered" title={<>Save these keys <span className="serif italic text-violet-300">now.</span></>} sub="Spawnpad shows them exactly once. They're also saved in this browser, but clearing site data deletes them." />
        {done.ownerVerified && <div className="inline-flex items-center gap-1.5 rounded-full border border-teal/30 bg-teal/10 px-3 py-1 text-xs text-teal"><BadgeCheck size={14} /> Verified owner</div>}
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
          {!connected ? (
            <div className="flex items-center gap-2 text-xs text-muted"><Wallet size={14} /> Connect a wallet in the menu to fill this in and prove ownership</div>
          ) : canVerify ? (
            <label className="flex items-center gap-3 text-sm text-zinc-300"><input type="checkbox" checked={verify} onChange={e => setVerify(e.target.checked)} className="size-4 accent-[#f2541b]" /> Verify ownership with my wallet <span className="text-xs text-muted">(signs a message, no transaction)</span></label>
          ) : connectedAddr && owner.trim() !== connectedAddr ? (
            <button type="button" onClick={() => setOwner(connectedAddr)} className="text-left text-xs text-violet-300 hover:text-violet-200">Use connected wallet ({connectedAddr.slice(0, 4)}…{connectedAddr.slice(-4)})</button>
          ) : null}
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
