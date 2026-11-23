import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CodeSpec, DataSpec } from "../../../packages/shared/src/types.ts";
import { canonicalJson, sha256 } from "./attest.ts";

export interface CheckResult { passed: boolean; lines: string[] }
const mark = (ok: boolean) => (ok ? "PASS" : "FAIL");

function toMillis(ts: unknown): number | null {
  if (typeof ts === "number") return ts < 1e12 ? ts * 1000 : ts;
  if (typeof ts === "string") { const t = Date.parse(ts); return Number.isNaN(t) ? null : t; }
  return null;
}

export function checkData(spec: DataSpec, decoded: string): CheckResult {
  const lines: string[] = [];
  let rows: unknown;
  try { rows = JSON.parse(decoded); } catch { return { passed: false, lines: ["FAIL payload is not valid JSON"] }; }
  if (!Array.isArray(rows)) return { passed: false, lines: ["FAIL payload is not a JSON array of rows"] };

  const fields = Object.entries(spec.schema);
  const bad: string[] = [];
  rows.forEach((row, i) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) { bad.push(`row ${i} is not an object`); return; }
    for (const [f, t] of fields) {
      const v = (row as Record<string, unknown>)[f];
      if (v === undefined) bad.push(`row ${i} missing '${f}'`);
      else if (typeof v !== t) bad.push(`row ${i} '${f}' is ${typeof v}, expected ${t}`);
    }
  });
  const schemaOk = bad.length === 0;
  lines.push(`${mark(schemaOk)} schema (${fields.length} fields)` + (schemaOk ? "" : `: ${bad.slice(0, 5).join("; ")}${bad.length > 5 ? ` (+${bad.length - 5} more)` : ""}`));

  const countOk = rows.length >= spec.minRows;
  lines.push(`${mark(countOk)} row count ${rows.length} >= ${spec.minRows}`);

  const seen = new Set<string>(); let dups = 0;
  for (const r of rows) { const k = canonicalJson(r); if (seen.has(k)) dups++; else seen.add(k); }
  const dupOk = dups === 0;
  lines.push(`${mark(dupOk)} no duplicate rows` + (dupOk ? "" : ` (${dups} duplicates)`));

  let freshOk = true;
  if (spec.maxAgeSeconds !== undefined && rows.length && rows.some((r: any) => r && "timestamp" in r)) {
    const now = Date.now(); const stale: number[] = [];
    rows.forEach((r: any, i) => { const ms = toMillis(r?.timestamp); if (ms === null || now - ms > spec.maxAgeSeconds! * 1000) stale.push(i); });
    freshOk = stale.length === 0;
    lines.push(`${mark(freshOk)} freshness <= ${spec.maxAgeSeconds}s` + (freshOk ? "" : ` (${stale.length} stale/invalid timestamps)`));
  } else if (spec.maxAgeSeconds !== undefined) {
    lines.push("SKIP freshness (no 'timestamp' field)");
  }
  return { passed: schemaOk && countOk && dupOk && freshOk, lines };
}

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), "sandbox-runner.cjs");

function runSandbox(payload: object, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--disallow-code-generation-from-strings", "--max-old-space-size=128", RUNNER], {
      stdio: ["pipe", "pipe", "pipe"], env: {},
    });
    let out = ""; let done = false;
    const finish = (v: any) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ error: `timed out after ${timeoutMs}ms` }); }, timeoutMs);
    child.stdout.on("data", (c) => (out += c));
    child.on("close", () => { try { finish(JSON.parse(out)); } catch { finish({ error: "sandbox crashed or produced no result" }); } });
    child.on("error", (e) => finish({ error: String(e) }));
    child.stdin.end(JSON.stringify(payload));
  });
}

export async function checkCode(spec: CodeSpec, source: string, testsB64?: string): Promise<CheckResult> {
  const lines: string[] = [];
  if (!testsB64) return { passed: false, lines: ["FAIL no test suite supplied"] };
  const testsBytes = Buffer.from(testsB64, "base64");
  const testsRaw = testsBytes.toString("utf8");
  const hashOk = sha256(testsBytes) === spec.testsHash;
  lines.push(`${mark(hashOk)} test suite hash matches spec.testsHash`);
  if (!hashOk) return { passed: false, lines };
  let tests: { args: unknown[]; expected: unknown }[];
  try { tests = JSON.parse(testsRaw); if (!Array.isArray(tests)) throw 0; } catch { return { passed: false, lines: [...lines, "FAIL tests are not a JSON array"] }; }

  const res = await runSandbox({ source, entry: spec.entry, tests });
  if (res.error) { lines.push(`FAIL sandbox: ${res.error}`); return { passed: false, lines }; }
  const results: any[] = res.results;
  const passedCount = results.filter((r) => r.pass).length;
  for (const r of results.filter((r) => !r.pass).slice(0, 5)) lines.push(`FAIL test #${r.i}` + (r.error ? `: ${r.error}` : `: got ${JSON.stringify(r.actual)}`));
  const ok = tests.length > 0 && passedCount === tests.length;
  lines.push(`${mark(ok)} ${passedCount}/${tests.length} tests passed`);
  return { passed: ok, lines };
}
