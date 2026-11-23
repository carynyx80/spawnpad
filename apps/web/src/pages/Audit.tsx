import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useKeystore } from "../keystore";
import { decrypt, demoKeys, type AuditResult } from "../api";
import { Card, Lock, Mono, short, timeAgo } from "../ui";

export default function Audit() {
  const loc = useLocation() as { state?: { viewingKey?: string } };
  const { agents: mine } = useKeystore();
  const [key, setKey] = useState(loc.state?.viewingKey ?? "");
  const [res, setRes] = useState<AuditResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<{ name: string; ownerViewingKey: string }[]>([]);
  useEffect(() => { demoKeys().then(setDemo); if (loc.state?.viewingKey) run(loc.state.viewingKey); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (k = key) => { setBusy(true); try { setRes(await decrypt(k)); } catch { setRes({ rows: [], error: "Couldn't reach the Spawnpad API." }); } setBusy(false); };
  const rows = res && !res.error ? res.rows.filter(r => r.kind !== "faucet") : null;
  const out = rows?.filter(r => r.direction === "out").reduce((s, r) => s + r.amount, 0) ?? 0;
  const inn = rows?.filter(r => r.direction === "in").reduce((s, r) => s + r.amount, 0) ?? 0;
  return (
    <div className="space-y-6">
      <div><h1 className="text-[28px] font-medium tracking-[-0.03em]">Owner audit</h1><p className="mt-1 text-sm text-muted">Paste your agent's viewing key to decrypt its spending. Decryption runs in your browser; the key is never sent to Spawnpad.</p></div>
      <Card className="p-5 glow">
        <label className="text-xs text-muted">Viewing key (X25519, base64)</label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input value={key} onChange={e => setKey(e.target.value)} placeholder="vk_…" className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2.5 font-mono text-sm outline-none focus:border-violet-500" />
          <button onClick={() => run()} disabled={busy || !key.trim()} className="rounded-lg bg-violet-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-60">{busy ? "Decrypting…" : "Decrypt"}</button>
        </div>
        {mine.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>Your agents:</span>
            {mine.map(d => <button key={d.agentId} onClick={() => { setKey(d.viewingKey); run(d.viewingKey); }} className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-violet-200 hover:border-violet-400/60">{d.name}</button>)}
          </div>
        )}
        {demo.length > 0 && mine.length === 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>Demo agents (local dev only):</span>
            {demo.map(d => <button key={d.name} onClick={() => { setKey(d.ownerViewingKey); run(d.ownerViewingKey); }} className="rounded-full border border-line bg-panel2 px-3 py-1 text-zinc-300 hover:border-zinc-600 hover:text-white">{d.name}</button>)}
          </div>
        )}
      </Card>

      {res?.error && <Card className="p-5 text-sm text-rose-300">{res.error}</Card>}
      {rows && rows.length === 0 && <Card className="p-5 text-sm text-muted">This agent hasn't paid or been paid for any jobs yet.</Card>}
      {rows && rows.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card className="p-4"><div className="text-xs text-muted">Agent</div><div className="mt-1 truncate font-medium">{res?.agent?.name}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted">Spent</div><div className="mt-1 text-xl font-semibold tabular-nums">{out.toFixed(2)} <span className="text-sm text-muted">USDC</span></div></Card>
            <Card className="p-4"><div className="text-xs text-muted">Received</div><div className="mt-1 text-xl font-semibold tabular-nums text-teal">{inn.toFixed(2)} <span className="text-sm text-muted">USDC</span></div></Card>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <div className="border-b border-line px-5 py-3.5"><h2 className="text-sm font-medium">What the public sees</h2><p className="text-xs text-muted">Solana explorer view</p></div>
              <ul className="divide-y divide-line">
                {rows.map(r => (
                  <li key={r.signature} className="px-5 py-3"><div className="flex justify-between text-xs text-muted"><Mono>{short(r.signature, 6, 4)}</Mono><span>{timeAgo(r.createdAt)}</span></div><div className="cipher mt-1 truncate text-xs"><Lock /> {r.ciphertext}</div></li>
                ))}
              </ul>
            </Card>
            <Card className="border-violet-500/30">
              <div className="border-b border-line px-5 py-3.5"><h2 className="text-sm font-medium">What you see</h2><p className="text-xs text-muted">Decrypted with your viewing key</p></div>
              <ul className="divide-y divide-line">
                {rows.map(r => (
                  <li key={r.signature} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0"><Link to={r.jobId ? `/app/jobs/${r.jobId}` : "#"} className="block truncate text-sm hover:text-violet-300">{r.jobTitle}</Link><div className="text-xs text-muted">{r.counterparty} · {timeAgo(r.createdAt)}</div></div>
                    <div className={`shrink-0 font-mono text-sm tabular-nums ${r.direction === "in" ? "text-teal" : ""}`}>{r.direction === "in" ? "+" : "−"}{r.amount.toFixed(2)} USDC</div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
