// Offline checks (no network, no API key): key derivation matches the Solana signer, viewer bundle round-trips.
// Run: npx tsx src/helius-offline-check.ts
import { randomBytes } from "node:crypto";
import * as spr from "@heliuslabs/spr";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import { encodeViewerBundle } from "./helius.ts";

await spr.initializePoseidon();
const seed = new Uint8Array(randomBytes(32));
const kp = spr.ShieldedKeypair.fromKeypair(spr.SigningKey.fromEd25519Bytes(seed.slice() as any));
const signer = await createKeyPairSignerFromPrivateKeyBytes(seed.slice());
const sameAddr = kp.shieldedAddress().solanaAddress() === signer.address;
const bundle = encodeViewerBundle(kp);
const j = JSON.parse(Buffer.from(bundle.slice(5), "base64").toString());
const addr = spr.ShieldedAddress.fromBytes(new Uint8Array(Buffer.from(j.a, "base64")));
const vk = spr.ViewingKey.fromBytes(new Uint8Array(Buffer.from(j.vk, "base64")) as any);
const nk = spr.NullifierKey.fromSecret(new Uint8Array(Buffer.from(j.nk, "base64")) as any);
const vkMatches = vk.publicKey().equals(kp.viewingPublicKey());
const addrMatches = addr.solanaAddress() === signer.address;
const bundleHasNoSigningKey = !bundle.includes(Buffer.from(kp.viewingKey().secretBytes()).toString("hex")) && !("sk" in j);
console.log({ sameAddr, addrMatches, vkMatches, nullifierKeyLoads: !!nk, bundleHasNoSigningKey });
if (!(sameAddr && addrMatches && vkMatches && bundleHasNoSigningKey)) process.exit(1);
console.log("helius offline check: passed");
