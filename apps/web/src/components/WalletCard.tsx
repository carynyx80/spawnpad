import { useCallback, useEffect, useState } from "react";
import { Wallet, ArrowDownToLine, ArrowUpFromLine, RefreshCw } from "lucide-react";
import { agentBalance, withdrawFunds, errorText, directory } from "../api";
import { Card, Mono } from "../ui";
import { Button, CopyButton, Field, inputCls } from "./kit";
import { useToast } from "./Toast";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Private balance, funding instructions and withdrawal for an agent whose API key is in this browser. */
export function WalletCard({ agentId, shieldedAddress, ownerWallet, apiKey }: { agentId: string; shieldedAddress: string; ownerWallet: string; apiKey?: string }) {
  const toast = useToast();
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [to, setTo] = useState(SOLANA_ADDRESS.test(ownerWallet) ? ownerWallet : "");
  const [amount, setAmount] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const real = directory.network === "mainnet" || directory.network === "devnet";

  const refresh = useCallback(async () => {
    if (!apiKey) return;
    setLoading(true);
    try { setBalance((await agentBalance(agentId, apiKey)).balance); } catch (e) { toast("error", "Couldn't load balance", errorText(e)); }
    setLoading(false);
  }, [agentId, apiKey, toast]);
  useEffect(() => { refresh(); }, [refresh]);

  const amt = Number(amount);
  const valid = SOLANA_ADDRESS.test(to.trim()) && amt > 0 && (balance === null || amt <= balance);

  const withdraw = async () => {
    setBusy(true);
    try {
      const r = await withdrawFunds(agentId, to.trim(), amt, apiKey);
      toast("success", `Withdrew ${amt.toFixed(2)} USDC`, `Transaction ${r.signature.slice(0, 10)}…`);
      setAmount(""); setReviewing(false); refresh();
    } catch (e) { toast("error", "Withdrawal failed", errorText(e)); }
    setBusy(false);
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-sm font-medium"><Wallet size={15} className="text-violet-300" /> Wallet
        <button onClick={refresh} className="ml-auto text-muted hover:text-white" aria-label="Refresh balance"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
      </div>
      <div className="mt-3 text-[28px] font-medium tabular-nums tracking-tight">{balance === null ? "—" : balance.toFixed(2)} <span className="text-sm text-muted">USDC</span></div>
      <p className="text-xs text-muted">Private balance. Only this agent's keys can see it.</p>

      <div className="mt-5 border-t border-line pt-4">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-300"><ArrowDownToLine size={13} /> Fund this agent</div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          {real ? "Send USDC privately through Helius Privacy Rings to the agent's shielded address:" : "Demo ring: new agents start with 1,000 test USDC. On mainnet you'd send USDC privately through Privacy Rings to:"}
        </p>
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2"><Mono className="min-w-0 flex-1 truncate text-teal">{shieldedAddress}</Mono><CopyButton text={shieldedAddress} label="" /></div>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-300"><ArrowUpFromLine size={13} /> Withdraw</div>
        {!apiKey ? <p className="mt-1.5 text-xs text-muted">Import this agent's API key to withdraw.</p> : !reviewing ? (
          <div className="mt-3 space-y-3">
            <Field label="To Solana wallet"><input className={inputCls} value={to} onChange={e => setTo(e.target.value)} placeholder="Wallet address" spellCheck={false} /></Field>
            <Field label="Amount (USDC)">
              <div className="flex gap-2">
                <input type="number" min="0" step="0.01" className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
                {balance !== null && <button className="shrink-0 rounded-lg border border-line px-3 text-xs text-muted hover:text-white" onClick={() => setAmount(String(balance))}>Max</button>}
              </div>
            </Field>
            <Button className="w-full" disabled={!valid} onClick={() => setReviewing(true)}>Review withdrawal</Button>
          </div>
        ) : (
          <div className="mt-3 space-y-3 rounded-xl border border-violet-500/30 bg-violet-500/[.06] p-3.5 text-xs">
            <div className="flex justify-between"><span className="text-muted">Amount</span><span className="font-mono text-zinc-100">{amt.toFixed(2)} USDC</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted">To</span><Mono className="truncate text-zinc-100">{to.trim()}</Mono></div>
            <p className="leading-relaxed text-muted">{real ? "This is a real on-chain payout and can't be reversed. The withdrawal amount becomes visible on Solana." : "Demo ring: no real funds move."}</p>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setReviewing(false)}>Back</Button>
              <Button className="flex-1" busy={busy} onClick={withdraw}>Confirm withdrawal</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
