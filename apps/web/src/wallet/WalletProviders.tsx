import { useCallback, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import type { WalletError } from "@solana/wallet-adapter-base";
import { useToast } from "../components/Toast";

// Wallets are discovered through the Wallet Standard (Phantom, Solflare, Backpack, Glow, OKX, Coinbase, Trust,
// Exodus, Magic Eden and any other standard wallet, as extensions or in their in-app browsers). On Android,
// the provider also registers the Solana Mobile Wallet Adapter, so installed wallet apps work from Chrome.
const RPC = (import.meta.env.VITE_SOLANA_RPC as string) || "https://api.mainnet-beta.solana.com";

export function WalletProviders({ children }: { children: React.ReactNode }) {
  const toast = useToast();
  const wallets = useMemo(() => [], []);
  const onError = useCallback((e: WalletError) => {
    const msg = e.message || e.name;
    if (/reject|cancel|closed/i.test(msg)) return; // the user backed out; nothing to report
    toast("error", "Wallet error", msg);
  }, [toast]);
  return (
    <ConnectionProvider endpoint={RPC}>
      <WalletProvider wallets={wallets} autoConnect onError={onError} localStorageKey="spawnpad.wallet">
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
