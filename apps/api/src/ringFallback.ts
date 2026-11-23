// Temporary in-memory ring used only when packages/ring is not present yet.
import { randomBytes } from "node:crypto";
import type { RingTransfer } from "../../../packages/shared/src/types.ts";
import type { Ring, ShieldedWallet, DecryptedTransfer } from "../../../packages/shared/src/ring-interface.ts";

export function createFallbackRing(): Ring {
  const wallets = new Map<string, ShieldedWallet & { balance: number }>();
  const txs: (RingTransfer & { amount: number })[] = [];
  const addr = () => randomBytes(32).toString("base64url").slice(0, 44);
  const rec = (from: string, to: string, amount: number, memo?: string) => {
    const t = { signature: randomBytes(48).toString("base64url"), from, to, amount,
      encryptedAmount: randomBytes(24).toString("base64"), memo, createdAt: new Date().toISOString() };
    txs.push(t);
    const { amount: _a, ...pub } = t;
    return pub as RingTransfer;
  };
  return {
    mode: "mock",
    async createShieldedWallet() {
      const w = { keyId: "key_" + randomBytes(8).toString("hex"), address: addr(),
        viewingKey: randomBytes(32).toString("base64"), viewingPubKey: randomBytes(32).toString("base64"), balance: 0 };
      wallets.set(w.keyId, w);
      const { balance: _b, ...pub } = w;
      return pub;
    },
    async deposit(keyId, amount) { const w = wallets.get(keyId)!; w.balance += amount; return rec("public", w.address, amount); },
    async transfer({ fromKeyId, to, amount, memo }) {
      const w = wallets.get(fromKeyId); if (!w) throw new Error("unknown key");
      if (w.balance < amount) throw new Error("insufficient private balance");
      w.balance -= amount;
      const dest = [...wallets.values()].find((x) => x.address === to); if (dest) dest.balance += amount;
      return rec(w.address, to, amount, memo);
    },
    async balance(keyId) { return wallets.get(keyId)?.balance ?? 0; },
    async listTransfers(address) {
      return txs.filter((t) => !address || t.from === address || t.to === address).map(({ amount: _a, ...p }) => p as RingTransfer);
    },
    async decryptForViewer(viewingKey, address) {
      const w = [...wallets.values()].find((x) => x.viewingKey === viewingKey && x.address === address);
      if (!w) throw new Error("viewing key does not match address");
      return txs.filter((t) => t.from === address || t.to === address)
        .map((t) => ({ ...t, direction: t.to === address ? "in" : "out" }) as DecryptedTransfer);
    },
  };
}
