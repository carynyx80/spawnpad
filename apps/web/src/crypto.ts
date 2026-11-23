// Browser-side crypto. Keys never leave the browser.
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

const { decodeBase64, encodeBase64, encodeUTF8, decodeUTF8 } = naclUtil;
export { decodeBase64, encodeBase64 };

/** Seal JSON to a viewing public key. Same format as @spawnpad/sdk: "rw1." + base64(ephPub | nonce | box). */
export function sealTo(viewingPubKey: string, value: unknown): string {
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ct = nacl.box(decodeUTF8(JSON.stringify(value)), nonce, decodeBase64(viewingPubKey), eph.secretKey);
  const out = new Uint8Array(32 + 24 + ct.length);
  out.set(eph.publicKey, 0); out.set(nonce, 32); out.set(ct, 56);
  return "rw1." + encodeBase64(out);
}

/** Open a sealed value. Accepts the SDK "rw1." format and the ring's base64(JSON{nonce,ephemeralPub,box}) format. Returns null on failure. */
export function openWith<T = unknown>(viewingKey: string, sealed: string): T | null {
  try {
    const sk = decodeBase64(viewingKey);
    let opened: Uint8Array | null;
    if (sealed.startsWith("rw1.")) {
      const raw = decodeBase64(sealed.slice(4));
      opened = nacl.box.open(raw.slice(56), raw.slice(32, 56), raw.slice(0, 32), sk);
    } else {
      const s = JSON.parse(encodeUTF8(decodeBase64(sealed))) as { nonce: string; ephemeralPub: string; box: string };
      opened = nacl.box.open(decodeBase64(s.box), decodeBase64(s.nonce), decodeBase64(s.ephemeralPub), sk);
    }
    return opened ? (JSON.parse(encodeUTF8(opened)) as T) : null;
  } catch { return null; }
}

export function pubKeyOf(viewingKey: string): string | null {
  try { const sk = decodeBase64(viewingKey.trim()); if (sk.length !== 32) return null; return encodeBase64(nacl.box.keyPair.fromSecretKey(sk).publicKey); } catch { return null; }
}

export const utf8ToB64 = (s: string) => encodeBase64(decodeUTF8(s));
export const b64ToUtf8 = (s: string) => encodeUTF8(decodeBase64(s));

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", decodeUTF8(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export interface SealedBudget { maxPrice: number; asset: "USDC"; note?: string }
export interface SealedBidBody { price: number; etaMinutes?: number; note?: string }
export interface SealedDeliverable { content: string }
