import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job } from "../../../packages/shared/src/types.ts";
import { loadOrCreateKeys, sha256, verifyAttestation } from "../src/attest.ts";
import { buildServer } from "../src/server.ts";

const keys = loadOrCreateKeys(join(mkdtempSync(join(tmpdir(), "vk-")), "k.json"));
const app = buildServer(keys);
const b64 = (s: string) => Buffer.from(s).toString("base64");

function job(kind: Job["kind"], spec: any): Job {
  return { id: "job_t", buyerAgentId: "agt_b", title: "t", description: "", kind, spec, specHash: "", encryptedBudget: "",
    asset: "USDC", deadline: new Date(Date.now() + 1e6).toISOString(), status: "funded", bidCount: 1, createdAt: new Date().toISOString() };
}
async function verify(j: Job, payload: string, tests?: string) {
  const res = await app.inject({ method: "POST", url: "/verify", payload: { job: j, payloadForVerifier: payload, tests } });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

const dataSpec = { schema: { name: "string", price: "number", timestamp: "string" }, minRows: 2, maxAgeSeconds: 3600 };
const now = new Date().toISOString();
const goodRows = [{ name: "a", price: 1, timestamp: now }, { name: "b", price: 2, timestamp: now }];

const testsJson = JSON.stringify([{ args: [2, 3], expected: 5 }, { args: [-1, 1], expected: 0 }, { args: [10, 5], expected: 15 }]);
const codeSpec = { language: "javascript", entry: "add", testsHash: sha256(Buffer.from(testsJson)) };

test("GET /pubkey", async () => {
  const r = await app.inject({ method: "GET", url: "/pubkey" });
  assert.equal(r.json().verifierPubKey, keys.publicKeyB64);
});

test("good data passes", async () => {
  const att = await verify(job("data_delivery", dataSpec), b64(JSON.stringify(goodRows)));
  assert.equal(att.passed, true, att.report);
  assert.equal(att.deliverableHash, sha256(Buffer.from(JSON.stringify(goodRows))));
});

test("bad schema fails", async () => {
  const att = await verify(job("data_delivery", dataSpec), b64(JSON.stringify([{ name: "a", price: "1", timestamp: now }, { name: "b", timestamp: now }])));
  assert.equal(att.passed, false);
  assert.match(att.report, /FAIL schema/);
});

test("too few rows, duplicates and stale data fail", async () => {
  const old = new Date(Date.now() - 7200e3).toISOString();
  const att = await verify(job("data_delivery", dataSpec), b64(JSON.stringify([{ name: "a", price: 1, timestamp: old }, { name: "a", price: 1, timestamp: old }])));
  assert.equal(att.passed, false);
  assert.match(att.report, /FAIL no duplicate rows/);
  assert.match(att.report, /FAIL freshness/);
});

test("code passes", async () => {
  const att = await verify(job("code_tests", codeSpec), b64("module.exports.add = (a, b) => a + b;"), b64(testsJson));
  assert.equal(att.passed, true, att.report);
});

test("code fails", async () => {
  const att = await verify(job("code_tests", codeSpec), b64("exports.add = (a, b) => a - b;"), b64(testsJson));
  assert.equal(att.passed, false);
  assert.match(att.report, /0\/3 tests passed|1\/3 tests passed/);
});

test("tests hash mismatch fails", async () => {
  const att = await verify(job("code_tests", codeSpec), b64("module.exports.add = (a, b) => a + b;"), b64(testsJson + " "));
  assert.equal(att.passed, false);
  assert.match(att.report, /FAIL test suite hash/);
});

test("infinite loop times out", async () => {
  const t0 = Date.now();
  const att = await verify(job("code_tests", codeSpec), b64("module.exports.add = () => { while (true) {} };"), b64(testsJson));
  assert.equal(att.passed, false);
  assert.ok(Date.now() - t0 < 6000);
  assert.match(att.report, /timed out|Script execution timed out/i);
});

test("require('fs') is blocked", async () => {
  const att = await verify(job("code_tests", codeSpec), b64("const fs = require('fs'); module.exports.add = (a,b)=>a+b;"), b64(testsJson));
  assert.equal(att.passed, false);
  assert.match(att.report, /not allowed/);
});

test("process and eval are unavailable", async () => {
  const att = await verify(job("code_tests", codeSpec), b64("module.exports.add = (a,b) => { return typeof process === 'undefined' ? eval('a+b') : -1 };"), b64(testsJson));
  assert.equal(att.passed, false);
});

test("signature verifies and tampering fails", async () => {
  const att = await verify(job("data_delivery", dataSpec), b64(JSON.stringify(goodRows)));
  assert.equal(verifyAttestation(att), true);
  assert.equal(verifyAttestation(att, keys.publicKeyB64), true);
  assert.equal(verifyAttestation({ ...att, passed: !att.passed }), false);
  assert.equal(verifyAttestation({ ...att, report: att.report + "x" }), false);
  assert.equal(verifyAttestation(att, "AAAA"), false);
});

test("bad request -> 400", async () => {
  const r = await app.inject({ method: "POST", url: "/verify", payload: { foo: 1 } });
  assert.equal(r.statusCode, 400);
});
