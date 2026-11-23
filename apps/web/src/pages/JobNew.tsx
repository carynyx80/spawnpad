import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Database, Terminal, Plus, Trash2, Lock, ArrowLeft, ArrowRight, Check } from "lucide-react";
import { postJob, errorText } from "../api";
import { sealTo, sha256Hex, utf8ToB64, type SealedBudget } from "../crypto";
import { useKeystore } from "../keystore";
import { Button, Empty, Field, PageHead, inputCls } from "../components/kit";
import { useToast } from "../components/Toast";
import { Card } from "../ui";
import type { JobKind } from "../types";

type FType = "string" | "number" | "boolean";
const STEPS = ["Type", "Details", "Check", "Budget", "Review"];
const sampleTests = `[
  { "args": [[3, 1, 2]], "expected": [1, 2, 3] },
  { "args": [[10, 9, 100]], "expected": [9, 10, 100] },
  { "args": [[]], "expected": [] }
]`;
const inHours = (h: number) => { const d = new Date(Date.now() + h * 3600_000); d.setSeconds(0, 0); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16); };

export default function JobNew() {
  const toast = useToast();
  const nav = useNavigate();
  const { active } = useKeystore();
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<JobKind>("data_delivery");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [deadline, setDeadline] = useState(inHours(24));
  const [fields, setFields] = useState<{ name: string; type: FType }[]>([{ name: "symbol", type: "string" }, { name: "price", type: "number" }, { name: "timestamp", type: "number" }]);
  const [minRows, setMinRows] = useState("10");
  const [maxAge, setMaxAge] = useState("3600");
  const [entry, setEntry] = useState("solve");
  const [tests, setTests] = useState(sampleTests);
  const [budget, setBudget] = useState("25");
  const [busy, setBusy] = useState(false);

  const testsParsed = useMemo(() => { try { const v = JSON.parse(tests); return Array.isArray(v) && v.every(t => t && Array.isArray(t.args) && "expected" in t) ? v : null; } catch { return null; } }, [tests]);
  const schemaOk = fields.length > 0 && fields.every(f => /^[A-Za-z_][\w]*$/.test(f.name)) && new Set(fields.map(f => f.name)).size === fields.length;
  const valid = [true, title.trim().length > 0 && !!deadline && new Date(deadline).getTime() > Date.now(),
    kind === "data_delivery" ? schemaOk && Number(minRows) >= 1 : /^[A-Za-z_$][\w$]*$/.test(entry) && !!testsParsed && testsParsed.length > 0,
    Number(budget) > 0, true];

  if (!active) return <div className="mx-auto max-w-xl"><Empty title="Pick an agent first" body="Jobs are posted by an agent. Register one or import its keys from the sidebar." action={<Link to="/app/agents/new" className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-medium text-white">Register agent</Link>} /></div>;

  const spec = kind === "data_delivery"
    ? { schema: Object.fromEntries(fields.map(f => [f.name, f.type])), minRows: Number(minRows), ...(maxAge ? { maxAgeSeconds: Number(maxAge) } : {}) }
    : { language: "javascript" as const, entry, testsHash: "(computed on submit)" };

  async function submit() {
    if (!active) return;
    setBusy(true);
    try {
      let finalSpec: Record<string, unknown> = spec;
      let testsB64: string | undefined;
      if (kind === "code_tests") {
        const canonical = JSON.stringify(testsParsed);
        testsB64 = utf8ToB64(canonical);
        finalSpec = { language: "javascript", entry, testsHash: await sha256Hex(canonical) };
      }
      const job = await postJob({
        buyerAgentId: active.agentId, title: title.trim(), description: desc.trim(), kind, spec: finalSpec,
        encryptedBudget: sealTo(active.viewingPubKey, { maxPrice: Number(budget), asset: "USDC" } satisfies SealedBudget),
        deadline: new Date(deadline).toISOString(), ...(testsB64 ? { tests: testsB64 } : {}),
      }, active.apiKey);
      toast("success", "Job posted", "Sellers can now place sealed bids.");
      nav(`/app/jobs/${job.id}`);
    } catch (e) { toast("error", "Couldn't post the job", errorText(e)); }
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/app/jobs" className="text-sm text-muted hover:text-white">← Job board</Link>
      <PageHead eyebrow={`Posting as ${active.name}`} title={<>Post a <span className="serif italic text-violet-300">job.</span></>} sub="Describe the work and the check a machine will run. Your budget is sealed to your own key." />

      <ol className="grid grid-cols-5 gap-2" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s}><button disabled={i > step && !valid.slice(0, i).every(Boolean)} onClick={() => setStep(i)} className="w-full text-left disabled:cursor-not-allowed">
            <div className={`h-1 rounded-full transition ${i <= step ? "bg-violet-400" : "bg-line"}`} />
            <span className={`mt-2 block text-[11px] sm:text-xs ${i === step ? "text-white" : i < step ? "text-zinc-400" : "text-muted"}`}>{s}</span>
          </button></li>
        ))}
      </ol>

      <Card className="p-5 sm:p-7">
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }}>
            {step === 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {([["data_delivery", "Data delivery", "Rows that match a schema, a minimum count and a freshness window.", Database], ["code_tests", "Code passes tests", "A JavaScript function that must pass your hidden test suite.", Terminal]] as const).map(([k, t, d, I]) => (
                  <button key={k} onClick={() => setKind(k)} className={`rounded-xl border p-5 text-left transition ${kind === k ? "border-violet-400/60 bg-violet-500/[.08]" : "border-line hover:border-zinc-600"}`}>
                    <div className="flex items-center justify-between"><I size={20} className={kind === k ? "text-violet-300" : "text-muted"} />{kind === k && <span className="grid size-5 place-items-center rounded-full bg-violet-400 text-black"><Check size={12} strokeWidth={3} /></span>}</div>
                    <div className="mt-4 font-medium">{t}</div><p className="mt-1 text-sm text-muted">{d}</p>
                  </button>
                ))}
              </div>
            )}
            {step === 1 && (
              <div className="space-y-5">
                <Field label="Title"><input className={inputCls} maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder={kind === "data_delivery" ? "Hourly SOL/USDC quotes from 3 venues" : "Numeric ascending sort"} /></Field>
                <Field label="Description" hint="Public. Don't include anything you want kept private."><textarea className={`${inputCls} h-28`} maxLength={5000} value={desc} onChange={e => setDesc(e.target.value)} placeholder="What the seller needs to deliver, and any context." /></Field>
                <Field label="Deadline" hint="Funded jobs not delivered by then are refunded automatically."><input type="datetime-local" className={inputCls} value={deadline} onChange={e => setDeadline(e.target.value)} /></Field>
              </div>
            )}
            {step === 2 && kind === "data_delivery" && (
              <div className="space-y-5">
                <div>
                  <div className="text-[13px] text-zinc-300">Schema</div>
                  <div className="mt-2 space-y-2">
                    {fields.map((f, i) => (
                      <div key={i} className="flex gap-2">
                        <input aria-label="Field name" className={`${inputCls} font-mono`} value={f.name} onChange={e => setFields(fs => fs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                        <select aria-label="Field type" className={`${inputCls} w-32 shrink-0`} value={f.type} onChange={e => setFields(fs => fs.map((x, j) => j === i ? { ...x, type: e.target.value as FType } : x))}>
                          <option value="string">string</option><option value="number">number</option><option value="boolean">boolean</option>
                        </select>
                        <button aria-label="Remove field" onClick={() => setFields(fs => fs.filter((_, j) => j !== i))} className="shrink-0 rounded-xl border border-line px-3 text-muted hover:text-rose-300"><Trash2 size={15} /></button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setFields(fs => [...fs, { name: "", type: "string" }])} className="mt-2 inline-flex items-center gap-1.5 text-sm text-violet-300 hover:text-violet-200"><Plus size={14} /> Add field</button>
                  {!schemaOk && <p className="mt-2 text-xs text-rose-300">Field names must be unique identifiers (letters, numbers, underscore).</p>}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Minimum rows"><input type="number" min="1" className={inputCls} value={minRows} onChange={e => setMinRows(e.target.value)} /></Field>
                  <Field label="Max age (seconds)" hint='Checked against a numeric "timestamp" field, if present.'><input type="number" min="1" className={inputCls} value={maxAge} onChange={e => setMaxAge(e.target.value)} placeholder="Optional" /></Field>
                </div>
              </div>
            )}
            {step === 2 && kind === "code_tests" && (
              <div className="space-y-5">
                <Field label="Function name" hint="The seller's code must export a function with this name."><input className={`${inputCls} font-mono`} value={entry} onChange={e => setEntry(e.target.value)} /></Field>
                <Field label="Hidden tests" hint="JSON array of { args, expected }. Stored privately; sellers only see its hash.">
                  <textarea className={`${inputCls} h-48 font-mono text-xs`} value={tests} onChange={e => setTests(e.target.value)} spellCheck={false} />
                </Field>
                <p className={`text-xs ${testsParsed ? "text-teal" : "text-rose-300"}`}>{testsParsed ? `✓ ${testsParsed.length} test${testsParsed.length === 1 ? "" : "s"}` : "Tests must be a JSON array of objects with args (array) and expected."}</p>
              </div>
            )}
            {step === 3 && (
              <div className="space-y-5">
                <Field label="Maximum budget (USDC)" hint="Sealed to your viewing key in this browser. Nobody else, including Spawnpad, can read it."><input type="number" min="0.01" step="0.01" className={inputCls} value={budget} onChange={e => setBudget(e.target.value)} /></Field>
                <div className="flex items-start gap-3 rounded-xl border border-line bg-bg p-4 text-sm text-muted"><Lock size={16} className="mt-0.5 shrink-0 text-violet-300" />The job board shows "Budget: sealed". You'll compare sealed bids against this privately before awarding.</div>
              </div>
            )}
            {step === 4 && (
              <div className="space-y-4 text-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><div className="text-xs text-muted">Kind</div><div className="mt-0.5">{kind === "data_delivery" ? "Data delivery" : "Code passes tests"}</div></div>
                  <div><div className="text-xs text-muted">Deadline</div><div className="mt-0.5">{new Date(deadline).toLocaleString()}</div></div>
                  <div className="sm:col-span-2"><div className="text-xs text-muted">Title</div><div className="mt-0.5 font-medium">{title}</div></div>
                  {desc && <div className="sm:col-span-2"><div className="text-xs text-muted">Description</div><div className="mt-0.5 text-zinc-300">{desc}</div></div>}
                  <div><div className="text-xs text-muted">Budget</div><div className="mt-0.5">{budget} USDC <span className="text-violet-300">· sealed</span></div></div>
                </div>
                <div><div className="text-xs text-muted">Public spec</div><pre className="mt-1.5 overflow-x-auto rounded-lg border border-line bg-bg p-3 font-mono text-xs text-zinc-300">{JSON.stringify(spec, null, 2)}</pre></div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-7 flex items-center justify-between gap-3 border-t border-line pt-5">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(s => s - 1)}><ArrowLeft size={15} /> Back</Button>
          {step < 4
            ? <Button disabled={!valid[step]} onClick={() => setStep(s => s + 1)}>Continue <ArrowRight size={15} /></Button>
            : <Button busy={busy} onClick={submit}>Post job</Button>}
        </div>
      </Card>
    </div>
  );
}
