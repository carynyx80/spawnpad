import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import type { Ring } from "../../../packages/shared/src/ring-interface.ts";
import { createFallbackRing } from "./ringFallback.ts";

export async function loadRing(dataDir: string): Promise<Ring> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const real = path.resolve(here, "../../../packages/ring/src/index.ts");
  if (existsSync(real)) {
    const mod = await import(pathToFileURL(real).href);
    const ring: Ring = mod.createRing({ mode: (process.env.RING_MODE as "mock" | "helius") ?? "mock", dataDir });
    console.log(`[ring] using packages/ring (${ring.mode})`);
    return ring;
  }
  console.warn("[ring] packages/ring not found, using in-memory fallback");
  return createFallbackRing();
}
