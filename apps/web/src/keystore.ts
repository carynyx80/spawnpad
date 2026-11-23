// Local keystore: agent credentials live only in this browser (localStorage "spawnpad.agents.v1").
import { useSyncExternalStore } from "react";

export interface LocalAgent { agentId: string; name: string; apiKey?: string; viewingKey: string; viewingPubKey: string; shieldedAddress: string; savedAt: string }
const KEY = "spawnpad.agents.v1";
const ACTIVE = "spawnpad.active.v1";
const listeners = new Set<() => void>();

const read = (): LocalAgent[] => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
let cache = read();
let active: string | null = (() => { try { return localStorage.getItem(ACTIVE); } catch { return null; } })();
const emit = () => listeners.forEach(l => l());
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(cache)); if (active) localStorage.setItem(ACTIVE, active); else localStorage.removeItem(ACTIVE); } catch { /* storage blocked: keep in memory */ } };

window.addEventListener("storage", e => { if (e.key === KEY || e.key === ACTIVE) { cache = read(); try { active = localStorage.getItem(ACTIVE); } catch { /* ignore */ } snap = { agents: cache, activeId: active }; emit(); } });

let snap = { agents: cache, activeId: active };
const update = () => { if (active && !cache.some(a => a.agentId === active)) active = cache[0]?.agentId ?? null; if (!active && cache[0]) active = cache[0].agentId; persist(); snap = { agents: cache, activeId: active }; emit(); };

export const keystore = {
  all: () => cache,
  get: (agentId: string) => cache.find(a => a.agentId === agentId),
  active: () => cache.find(a => a.agentId === active) ?? null,
  save(a: Omit<LocalAgent, "savedAt">) { cache = [...cache.filter(x => x.agentId !== a.agentId), { ...a, savedAt: new Date().toISOString() }]; active = a.agentId; update(); },
  remove(agentId: string) { cache = cache.filter(a => a.agentId !== agentId); update(); },
  setActive(agentId: string) { active = agentId; update(); },
  exportJson: (list = cache) => JSON.stringify(list.map(({ savedAt: _s, ...rest }) => rest), null, 2),
};

export function useKeystore() {
  const s = useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => snap);
  return { agents: s.agents, active: s.agents.find(a => a.agentId === s.activeId) ?? null };
}

export function download(filename: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
