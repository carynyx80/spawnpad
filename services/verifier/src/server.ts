import Fastify from "fastify";
import { loadOrCreateKeys } from "./attest.ts";
import { runVerification, type VerifyRequest } from "./verify.ts";

export function buildServer(keys = loadOrCreateKeys(process.env.VERIFIER_KEYS_FILE)) {
  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 });
  app.get("/health", async () => ({ ok: true }));
  app.get("/pubkey", async () => ({ verifierPubKey: keys.publicKeyB64 }));
  app.post<{ Body: VerifyRequest }>("/verify", async (req, reply) => {
    const b = req.body;
    if (!b || !b.job || !b.job.id || !b.job.kind || !b.job.spec || typeof b.payloadForVerifier !== "string")
      return reply.code(400).send({ error: "body must be {job, payloadForVerifier, tests?}" });
    return runVerification(b, keys);
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("server.ts")) {
  const port = Number(process.env.VERIFIER_PORT ?? 4200);
  buildServer().listen({ port, host: process.env.VERIFIER_HOST ?? "127.0.0.1" }).then(() => console.log(`verifier listening on :${port}`));
}
