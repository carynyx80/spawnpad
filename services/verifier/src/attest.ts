import { createHash, createPublicKey, generateKeyPairSync, sign, verify, KeyObject, createPrivateKey } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Attestation } from "../../../packages/shared/src/types.ts";

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Canonical JSON: object keys sorted recursively. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

function attestationMessage(att: Omit<Attestation, "signature"> | Attestation): Buffer {
  const { signature: _s, ...rest } = att as Attestation;
  return Buffer.from(canonicalJson(rest));
}

/** Raw 32-byte ed25519 public key (base64) -> KeyObject */
function publicKeyFromRaw(b64: string): KeyObject {
  const raw = Buffer.from(b64, "base64");
  const prefix = Buffer.from("302a300506032b6570032100", "hex"); // SPKI header for ed25519
  return createPublicKey({ key: Buffer.concat([prefix, raw]), format: "der", type: "spki" });
}

/** Verify an attestation's ed25519 signature against its embedded verifierPubKey.
 *  Optionally pin an expected verifier public key. */
export function verifyAttestation(att: Attestation, expectedPubKey?: string): boolean {
  try {
    if (expectedPubKey && att.verifierPubKey !== expectedPubKey) return false;
    return verify(null, attestationMessage(att), publicKeyFromRaw(att.verifierPubKey), Buffer.from(att.signature, "base64"));
  } catch {
    return false;
  }
}

export interface VerifierKeys { privateKey: KeyObject; publicKeyB64: string }

export function loadOrCreateKeys(file?: string): VerifierKeys {
  const path = file ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".keys", "verifier.json");
  if (existsSync(path)) {
    const j = JSON.parse(readFileSync(path, "utf8"));
    return { privateKey: createPrivateKey({ key: j.privateKeyPem, format: "pem" }), publicKeyB64: j.publicKey };
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const publicKeyB64 = spki.subarray(spki.length - 32).toString("base64");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ publicKey: publicKeyB64, privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }) }), { mode: 0o600 });
  return { privateKey, publicKeyB64 };
}

export function signAttestation(unsigned: Omit<Attestation, "signature" | "verifierPubKey">, keys: VerifierKeys): Attestation {
  const body = { ...unsigned, verifierPubKey: keys.publicKeyB64 };
  const signature = sign(null, attestationMessage(body), keys.privateKey).toString("base64");
  return { ...body, signature };
}
