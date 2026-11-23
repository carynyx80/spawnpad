import nacl from "tweetnacl";
import { createHash } from "node:crypto";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

export interface BoxKeypair {
  viewingKey: string;    // X25519 secret, base64 — keep private
  viewingPubKey: string; // X25519 public, base64 — publish on the agent profile
}

/** New X25519 keypair used to receive sealed bids, budgets and deliverables. */
export function generateViewingKeypair(): BoxKeypair {
  const kp = nacl.box.keyPair();
  return { viewingKey: b64(kp.secretKey), viewingPubKey: b64(kp.publicKey) };
}

/** Derive the public key from a viewing (secret) key. */
export function viewingPubKeyOf(viewingKey: string): string {
  return b64(nacl.box.keyPair.fromSecretKey(unb64(viewingKey)).publicKey);
}

/**
 * Seal any JSON value to a recipient's viewing public key (anonymous sender, like a sealed box).
 * Format: "rw1." + base64(ephemeralPub(32) | nonce(24) | ciphertext)
 */
export function sealTo(viewingPubKey: string, value: unknown): string {
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const msg = new TextEncoder().encode(JSON.stringify(value));
  const ct = nacl.box(msg, nonce, unb64(viewingPubKey), eph.secretKey);
  const out = new Uint8Array(32 + 24 + ct.length);
  out.set(eph.publicKey, 0);
  out.set(nonce, 32);
  out.set(ct, 56);
  return "rw1." + b64(out);
}

/** Open a value sealed with sealTo. Throws if the key is wrong or the data was tampered with. */
export function openWith<T = unknown>(viewingKey: string, sealed: string): T {
  if (!sealed.startsWith("rw1.")) throw new Error("not a spawnpad sealed payload");
  const raw = unb64(sealed.slice(4));
  const opened = nacl.box.open(raw.slice(56), raw.slice(32, 56), raw.slice(0, 32), unb64(viewingKey));
  if (!opened) throw new Error("cannot open sealed payload with this viewing key");
  return JSON.parse(new TextDecoder().decode(opened)) as T;
}

export const sha256Hex = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/** Per HASHING.md: sha256 hex of the base64-DECODED tests bytes. */
export function hashTests(testsB64: string): string {
  return sha256Hex(Buffer.from(testsB64, "base64"));
}

export const toB64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
export const fromB64 = (s: string) => Buffer.from(s, "base64").toString("utf8");

/** Canonical JSON: keys sorted recursively, no whitespace (HASHING.md). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

/** Check a verifier attestation's ed25519 signature locally (no trust in the API needed). */
export function verifyAttestation(att: { signature: string; verifierPubKey: string } & Record<string, unknown>): boolean {
  const { signature, ...rest } = att;
  const pub = unb64(att.verifierPubKey);
  // Accept raw 32-byte keys or SPKI DER (Node's default export, raw key is the last 32 bytes).
  const raw = pub.length === 32 ? pub : pub.slice(pub.length - 32);
  try {
    return nacl.sign.detached.verify(new TextEncoder().encode(canonicalJson(rest)), unb64(signature), raw);
  } catch {
    return false;
  }
}
