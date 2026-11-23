// Runs untrusted seller code. Spawned as a child process with
// --disallow-code-generation-from-strings; reads {source, entry, tests} from stdin.
"use strict";
const vm = require("node:vm");
const { isDeepStrictEqual } = require("node:util");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };
  let job;
  try { job = JSON.parse(input); } catch (e) { return out({ error: "bad runner input" }); }
  const module = { exports: {} };
  const blockedRequire = (name) => { throw new Error(`require('${name}') is not allowed in the sandbox`); };
  const sandbox = { module, exports: module.exports, require: blockedRequire, console: { log() {}, error() {}, warn() {} } };
  const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  try {
    new vm.Script(job.source, { filename: "deliverable.js" }).runInContext(ctx, { timeout: 2500 });
  } catch (e) { return out({ error: "load failed: " + String(e && e.message || e) }); }
  const fn = (sandbox.module.exports && sandbox.module.exports[job.entry]) || (sandbox.exports && sandbox.exports[job.entry]);
  if (typeof fn !== "function") return out({ error: `entry '${job.entry}' is not an exported function` });
  const results = [];
  for (let i = 0; i < job.tests.length; i++) {
    const t = job.tests[i];
    try {
      ctx.__fn = fn; ctx.__args = JSON.parse(JSON.stringify(t.args));
      const actual = vm.runInContext("__fn(...__args)", ctx, { timeout: 2500 });
      const plain = actual === undefined ? undefined : JSON.parse(JSON.stringify(actual));
      results.push({ i, pass: isDeepStrictEqual(plain, t.expected), actual: plain });
    } catch (e) {
      results.push({ i, pass: false, error: String(e && e.message || e) });
    }
  }
  out({ results });
});
