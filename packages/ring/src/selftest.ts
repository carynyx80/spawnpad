import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRing, sealTo, openWith } from "./index.ts";

const dataDir = mkdtempSync(join(tmpdir(), "ring-selftest-"));
const ring = createRing({ dataDir });
const A = await ring.createShieldedWallet("A");
const B = await ring.createShieldedWallet("B");
const C = await ring.createShieldedWallet("C");

await ring.deposit(A.keyId, 100);
await ring.deposit(B.keyId, 50);
const ab = await ring.transfer({ fromKeyId: A.keyId, to: B.address, amount: 30, memo: "job_123" });
await ring.transfer({ fromKeyId: B.keyId, to: C.address, amount: 20 });

assert.equal(await ring.balance(A.keyId), 70);
assert.equal(await ring.balance(B.keyId), 60);
assert.equal(await ring.balance(C.keyId), 20);
console.log("✓ balances correct (A=70 B=60 C=20)");

await assert.rejects(ring.transfer({ fromKeyId: C.keyId, to: A.address, amount: 21 }), /insufficient/);
assert.equal(await ring.balance(C.keyId), 20);
console.log("✓ insufficient funds rejected");

const pub = await ring.listTransfers();
assert.equal(pub.length, 4);
for (const t of pub) {
  assert.ok(!("amount" in t), "public view leaks amount");
  assert.ok(t.encryptedAmount.length > 20 && !/\b(30|20|100|50)\b/.test(t.encryptedAmount));
}
assert.ok(!JSON.stringify(pub).includes("job_123"), "public view leaks memo");
console.log("✓ public view shows ciphertext only (addresses visible, amounts/memos hidden)");

const aView = await ring.decryptForViewer(A.viewingKey, A.address);
assert.deepEqual(aView.map((t) => [t.direction, t.amount]), [["in", 100], ["out", 30]]);
assert.equal(aView[1].memo, "job_123");
assert.equal((await ring.decryptForViewer(A.viewingKey, B.address)).length, 0, "A's key must not decrypt B↔C");
assert.equal((await ring.decryptForViewer(A.viewingKey, C.address)).length, 0);
const bView = await ring.decryptForViewer(B.viewingKey, B.address);
assert.deepEqual(bView.map((t) => [t.direction, t.amount]), [["in", 50], ["in", 30], ["out", 20]]);
assert.equal(bView.find((t) => t.signature === ab.signature)?.amount, 30);
console.log("✓ viewing key A decrypts A's transfers only; B sees both sides of its own");

const ring2 = createRing({ dataDir });
assert.equal(await ring2.balance(A.keyId), 70);
console.log("✓ state persisted across restart");

const sealed = sealTo(A.viewingPubKey, { price: 12.5 });
assert.deepEqual(openWith(A.viewingKey, sealed), { price: 12.5 });
assert.equal(openWith(B.viewingKey, sealed), null);
console.log("✓ sealTo/openWith: only holder of viewing key opens sealed bids");
// Envelopes: open client-side with only the viewing secret key (procedure documented in ring-interface.ts)
{
  const nacl = (await import("tweetnacl")).default;
  const b64 = (x: string) => Uint8Array.from(Buffer.from(x, "base64"));
  const envs = await ring.listEnvelopes!(A.address);
  assert.ok(envs.length > 0, "A has envelopes");
  const decrypted = await ring.decryptForViewer(A.viewingKey, A.address);
  for (const e of envs) {
    const plain = nacl.box.open(b64(e.envelope.box), b64(e.envelope.nonce), b64(e.envelope.ephemeralPubKey), b64(A.viewingKey));
    assert.ok(plain, "A's viewing key opens A's envelope");
    const p = JSON.parse(Buffer.from(plain!).toString("utf8"));
    assert.equal(p.asset, "USDC");
    assert.equal(p.amount, decrypted.find((d) => d.signature === e.signature)!.amount);
    assert.equal(nacl.box.open(b64(e.envelope.box), b64(e.envelope.nonce), b64(e.envelope.ephemeralPubKey), b64(B.viewingKey)), null, "B cannot open A's envelope");
  }
  console.log(`✓ listEnvelopes: ${envs.length} envelopes open client-side with A's viewing key only`);
}
console.log("ALL RING SELFTESTS PASSED");
