import { createHash, createPublicKey, verify as edVerify } from "node:crypto";

export function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

export const sha256Hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

// Accepts a raw 32-byte ed25519 key (base64) or an SPKI DER key (base64).
export function verifyEd25519(pubB64: string, message: string, sigB64: string): boolean {
  try {
    let der = Buffer.from(pubB64, "base64");
    if (der.length === 32) der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), der]);
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    return edVerify(null, Buffer.from(message), key, Buffer.from(sigB64, "base64"));
  } catch {
    return false;
  }
}
