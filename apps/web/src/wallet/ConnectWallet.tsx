import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { Wallet as WalletIcon, Copy, ExternalLink, LogOut, Repeat, Smartphone, ChevronUp, Check, Loader2 } from "lucide-react";
import { Modal } from "../components/kit";
import { useToast } from "../components/Toast";
import { walletBalances } from "../api";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const isIOS = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);

// Wallets that can open Spawnpad inside their in-app browser (phones without an injected wallet).
const inAppBrowsers = (url: string, ref: string) => [
  { name: "Phantom", href: `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}` },
  { name: "Solflare", href: `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}` },
  { name: "Backpack", href: `https://backpack.app/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}` },
];
const installLinks = [
  { name: "Phantom", href: "https://phantom.com/download" },
  { name: "Solflare", href: "https://solflare.com/download" },
  { name: "Backpack", href: "https://backpack.app/downloads" },
];

/** Picker for every Solana wallet the browser exposes, plus phone fallbacks. */
export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { wallets, select, connect, wallet, connected, connecting } = useWallet();
  const [pending, setPending] = useState<WalletName | null>(null);
  const toast = useToast();

  const detected = useMemo(() => wallets.filter(w => w.readyState === WalletReadyState.Installed), [wallets]);
  const loadable = useMemo(() => wallets.filter(w => w.readyState === WalletReadyState.Loadable), [wallets]);

  // Connect once the chosen wallet is selected (select() is async in the provider).
  useEffect(() => {
    if (!pending || !wallet || wallet.adapter.name !== pending || connected || connecting) return;
    connect().catch(() => { /* surfaced by the provider's onError */ }).finally(() => setPending(null));
  }, [pending, wallet, connected, connecting, connect]);
  useEffect(() => { if (connected && open) { onClose(); toast("success", "Wallet connected", wallet?.adapter.name); } }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (name: WalletName) => { setPending(name); select(name); };
  const here = typeof window !== "undefined" ? window.location.href : "https://www.spawnpad.online/app";
  const origin = typeof window !== "undefined" ? window.location.origin : "https://www.spawnpad.online";

  const Row = ({ name, icon, sub, onClick, busy }: { name: string; icon?: string; sub: string; onClick: () => void; busy?: boolean }) => (
    <button onClick={onClick} disabled={busy} className="flex w-full items-center gap-3 rounded-xl border border-line bg-panel2/50 px-3.5 py-3 text-left transition hover:border-zinc-600 hover:bg-panel2 disabled:opacity-60">
      {icon ? <img src={icon} alt="" className="size-8 rounded-lg" /> : <div className="grid size-8 place-items-center rounded-lg bg-panel text-muted"><Smartphone size={16} /></div>}
      <div className="min-w-0 flex-1"><div className="text-sm font-medium">{name}</div><div className="text-xs text-muted">{sub}</div></div>
      {busy ? <Loader2 size={16} className="animate-spin text-muted" /> : <ChevronUp size={16} className="rotate-90 text-muted" />}
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} title="Connect a Solana wallet">
      <div className="space-y-5">
        {detected.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted">Detected in this browser</div>
            {detected.map(w => <Row key={w.adapter.name} name={w.adapter.name} icon={w.adapter.icon} sub="Ready to connect" busy={pending === w.adapter.name} onClick={() => choose(w.adapter.name)} />)}
          </div>
        )}
        {loadable.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted">Wallet apps on this phone</div>
            {loadable.map(w => <Row key={w.adapter.name} name={w.adapter.name === "Mobile Wallet Adapter" ? "Use an installed wallet app" : w.adapter.name} icon={w.adapter.icon} sub="Phantom, Solflare, Backpack and other Android wallets" busy={pending === w.adapter.name} onClick={() => choose(w.adapter.name)} />)}
          </div>
        )}
        {detected.length === 0 && (isMobile() ? (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted">{isIOS() ? "Open Spawnpad in your wallet app" : "Or open Spawnpad inside your wallet app"}</div>
            <div className="grid grid-cols-3 gap-2">
              {inAppBrowsers(here, origin).map(l => <a key={l.name} href={l.href} className="rounded-xl border border-line bg-panel2/50 px-3 py-2.5 text-center text-sm hover:border-zinc-600">{l.name}</a>)}
            </div>
            <p className="text-xs leading-relaxed text-muted">Your wallet app opens this page in its built-in browser, where you can connect directly.</p>
          </div>
        ) : loadable.length === 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted">No wallet found in this browser</div>
            <p className="text-xs leading-relaxed text-muted">Install a Solana wallet extension, then reload this page. Any wallet that supports the Solana Wallet Standard works.</p>
            <div className="grid grid-cols-3 gap-2">
              {installLinks.map(l => <a key={l.name} href={l.href} target="_blank" rel="noreferrer" className="rounded-xl border border-line bg-panel2/50 px-3 py-2.5 text-center text-sm hover:border-zinc-600">{l.name}</a>)}
            </div>
          </div>
        ))}
        <p className="border-t border-line pt-4 text-xs leading-relaxed text-muted">Connecting only shares your public address. Spawnpad never asks for your seed phrase and can't move funds from your wallet.</p>
      </div>
    </Modal>
  );
}

/** Connect button for the bottom of the drawer; becomes an account menu once connected. */
export function ConnectWallet({ compact }: { compact?: boolean }) {
  const { publicKey, wallet, connected, connecting, disconnect } = useWallet();
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [menu, setMenu] = useState(false);
  const [bal, setBal] = useState<{ sol: number; usdc: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const address = publicKey?.toBase58();

  useEffect(() => {
    setBal(null);
    if (!address) return;
    let live = true;
    walletBalances(address).then(b => { if (live) setBal(b); }).catch(() => { /* balances are a nice-to-have */ });
    return () => { live = false; };
  }, [address]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [menu]);

  if (!connected || !address) {
    return (
      <>
        <button onClick={() => setModal(true)} disabled={connecting} className={`flex w-full items-center justify-center gap-2 rounded-xl border border-violet-400/40 bg-violet-500/10 px-3 py-2.5 text-sm font-medium text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-60 ${compact ? "" : ""}`}>
          {connecting ? <Loader2 size={15} className="animate-spin" /> : <WalletIcon size={15} />}{connecting ? "Connecting…" : "Connect wallet"}
        </button>
        <WalletModal open={modal} onClose={() => setModal(false)} />
      </>
    );
  }

  const copy = async () => { try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { toast("error", "Couldn't copy"); } };
  return (
    <div ref={ref} className="relative">
      <AnimatePresence>
        {menu && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-line bg-panel shadow-[0_20px_50px_-15px_rgba(0,0,0,.8)]">
            <div className="border-b border-line p-3.5">
              <div className="text-xs text-muted">{wallet?.adapter.name}</div>
              <div className="mt-1 font-mono text-[12.5px] text-zinc-200">{short(address)}</div>
              <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-panel2 px-2.5 py-1.5"><div className="text-muted">SOL</div><div className="font-mono text-zinc-100">{bal ? bal.sol.toFixed(4) : "—"}</div></div>
                <div className="rounded-lg bg-panel2 px-2.5 py-1.5"><div className="text-muted">USDC</div><div className="font-mono text-zinc-100">{bal ? bal.usdc.toFixed(2) : "—"}</div></div>
              </div>
            </div>
            <div className="p-1.5 text-sm">
              <button onClick={copy} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-panel2">{copied ? <Check size={15} className="text-teal" /> : <Copy size={15} className="text-muted" />}{copied ? "Copied" : "Copy address"}</button>
              <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-panel2"><ExternalLink size={15} className="text-muted" /> View on Solscan</a>
              <button onClick={() => { setMenu(false); setModal(true); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-panel2"><Repeat size={15} className="text-muted" /> Change wallet</button>
              <button onClick={() => { setMenu(false); disconnect().catch(() => {}); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-rose-300 hover:bg-panel2"><LogOut size={15} /> Disconnect</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button onClick={() => setMenu(m => !m)} aria-expanded={menu} className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-panel px-3 py-2.5 text-left transition hover:border-zinc-600">
        {wallet?.adapter.icon ? <img src={wallet.adapter.icon} alt="" className="size-6 rounded-md" /> : <WalletIcon size={16} />}
        <div className="min-w-0 flex-1"><div className="font-mono text-[12.5px] text-zinc-100">{short(address)}</div><div className="text-[11px] text-muted">{bal ? `${bal.usdc.toFixed(2)} USDC · ${bal.sol.toFixed(3)} SOL` : wallet?.adapter.name}</div></div>
        <span className="size-2 rounded-full bg-teal shadow-[0_0_8px_#5eead4]" aria-hidden />
      </button>
      <WalletModal open={modal} onClose={() => setModal(false)} />
    </div>
  );
}
