import type { Attestation, CodeSpec, DataSpec, Job } from "../../../packages/shared/src/types.ts";
import { sha256, signAttestation, type VerifierKeys } from "./attest.ts";
import { checkCode, checkData } from "./checks.ts";

export interface VerifyRequest { job: Job; payloadForVerifier: string; tests?: string }

export async function runVerification(req: VerifyRequest, keys: VerifierKeys): Promise<Attestation> {
  const bytes = Buffer.from(req.payloadForVerifier ?? "", "base64");
  const decoded = bytes.toString("utf8");
  const result = req.job.kind === "data_delivery"
    ? checkData(req.job.spec as DataSpec, decoded)
    : req.job.kind === "code_tests"
      ? await checkCode(req.job.spec as CodeSpec, decoded, req.tests)
      : { passed: false, lines: [`FAIL unknown job kind '${(req.job as Job).kind}'`] };
  return signAttestation({
    jobId: req.job.id,
    passed: result.passed,
    report: result.lines.join("\n"),
    deliverableHash: sha256(bytes),
    verifiedAt: new Date().toISOString(),
  }, keys);
}
