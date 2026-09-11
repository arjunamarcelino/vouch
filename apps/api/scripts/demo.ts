/**
 * Seeded demo workflow driver. Reports integration readiness against a running API and prints the
 * canonical on-camera flow as concrete API calls. Honest per the repo's fail-explicit philosophy: it
 * degrades to a clear "not configured / not running" state rather than faking success.
 *
 * Run:  API_BASE=http://localhost:3001 node --import @swc-node/register/esm-register scripts/demo.ts
 */

const API_BASE = (process.env.API_BASE ?? "http://localhost:3001").replace(/\/$/u, "");

interface Probe {
  name: string;
  status: string;
  critical: boolean;
  latencyMs: number;
  error?: string;
}

async function readiness(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/health/integrations`);
    const body = (await res.json()) as { status: string; probes: Probe[] };
    console.log(`\nIntegration readiness (${API_BASE}) — overall: ${body.status}`);
    for (const p of body.probes) {
      const mark = p.status === "up" ? "✓" : p.status === "degraded" ? "~" : "✗";
      console.log(`  ${mark} ${p.name.padEnd(10)} ${p.status.padEnd(9)} ${p.latencyMs}ms${p.error ? `  (${p.error})` : ""}`);
    }
  } catch {
    console.log(`\n✗ API not reachable at ${API_BASE}. Start it: pnpm --filter @vouch/api dev`);
  }
}

function flow(): void {
  console.log(`
Canonical demo flow (prepare → sign in wallet → track). Every write needs an Idempotency-Key header.

 1. Sign in (SIWE)
      POST /auth/nonce                     → { nonce }
      POST /auth/verify { message, signature }  (wallet signs EIP-4361) → session cookie
 2. Allowance (client approves the hub for taskFee+serviceFee)
      GET  /allowance                      → { allowance }
      POST /allowance/approve/prepare { amount }  → TransactionRequest → sign → POST /transactions/track
 3. Create + fund the job (client)
      POST /jobs/prepare { provider, taskFee, guaranteeAmount, serviceFee, submissionDeadline,
                           coverageDuration, publicCriteriaHash, privateCriteriaCommitment }
        → TransactionRequest → wallet signs → POST /transactions/track { txHash, preparedId }
        → tracker verifies receipt + extracts jobId from JobCreated
 4. Provider accepts (locks collateral): approve → POST /jobs/:id/accept/prepare → sign → track
 5. Provider submits deliverable: POST /jobs/:id/deliverable/prepare { submissionCommitment }
 6. Evaluator approves:            POST /jobs/:id/evaluate/prepare { approved: true }
 7. Request an agent quote:        POST /quotes { jobRequest } ; GET /quotes/:id/explanation
 8. Client opens a claim (=confidential-evaluation request; CRE triggers off ClaimOpened):
      POST /claims/:jobId/prepare { commitment }  → sign → track
 9. Watch the verdict:            GET /claims/:jobId/status  → PENDING → COVERED_PAID | REJECTED_CONSUMED | TIMED_OUT
10. Provider reputation:          GET /providers/:address/performance   (Graph, fail-closed)

Offchain demo state (admin, DEMO_MODE=true, demo chain only):
      POST /demo/reset     POST /demo/seed
`);
}

async function main(): Promise<void> {
  console.log("Vouch — assurance protocol demo driver");
  await readiness();
  flow();
}

await main();
