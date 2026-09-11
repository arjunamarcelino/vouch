import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAbiParameters } from "viem";
import { configSchema, type Config } from "./config";
import { VERDICT_ABI_PARAMS } from "./encoding";
import { runEvaluation, type EvalPort, type JobView } from "./port";
// Fixtures via JSON module imports — the CRE sandbox types `node:fs` as `never`,
// so file reads are done with resolveJsonModule instead.
import validPass from "./fixtures/valid-pass.json" with { type: "json" };
import validFailure from "./fixtures/valid-failure.json" with { type: "json" };
import invalidCommit from "./fixtures/invalid-commit.json" with { type: "json" };
import replay from "./fixtures/replay.json" with { type: "json" };
import timeoutError from "./fixtures/timeout-error.json" with { type: "json" };

// Seeded job — the pass/failure/replay fixtures' commitHash must match this.
const SUBMISSION_COMMITMENT =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const GUARANTEE = 100_000_000n;
const JOB_ID = 42n;
const FIXED_NOW = 1_700_000_000n;

// High-entropy sentinel. Injected as a secret; must NEVER surface in the payload.
const SENTINEL_TOKEN = "SENTINEL_TOKEN_1a2b3c4d5e6f7081";
const THRESHOLD = "0.9"; // numeric threshold secret (must parse finite)

const CFG: Config = configSchema.parse({
  chainSelectorName: "arc-testnet",
  chainId: "5042002",
  assuranceHubAddress: "0x00000000000000000000000000000000000000a1",
  owner: "0x00000000000000000000000000000000000000b2",
  gasLimit: "500000",
  testApiUrl: "https://example.invalid/private-test",
  workflowId:
    "0x00000000000000000000000000000000000000000000000000000000deadbeef",
});

interface MockOpts {
  job?: JobView | null;
  secret?: string | undefined;
  fetchOk?: boolean;
  body?: unknown;
  emitOk?: boolean;
}

function makePort(opts: MockOpts) {
  const calls = { emitReport: 0, getSecret: 0 };
  let lastPayload: `0x${string}` | undefined;
  const port: EvalPort = {
    async getSecret(id) {
      calls.getSecret += 1;
      // The token sentinel is provisioned but never consumed by the orchestrator.
      if (id === "token") return SENTINEL_TOKEN;
      return opts.secret;
    },
    async confidentialFetch() {
      return { ok: opts.fetchOk ?? true, body: opts.body };
    },
    async getJob() {
      return opts.job === undefined
        ? {
            status: 5,
            guaranteeAmount: GUARANTEE,
            submissionCommitment: SUBMISSION_COMMITMENT,
          }
        : opts.job;
    },
    async emitReport(payload) {
      calls.emitReport += 1;
      lastPayload = payload;
      return { ok: opts.emitOk ?? true };
    },
    now() {
      return FIXED_NOW;
    },
  };
  return { port, calls, getPayload: () => lastPayload };
}

function decode(payload: `0x${string}`) {
  const [chainId, hub, jobId, covered, amount, commitment, evaluatedAt] =
    decodeAbiParameters(VERDICT_ABI_PARAMS, payload);
  return { chainId, hub, jobId, covered, amount, commitment, evaluatedAt };
}

function payloadOf(payload: `0x${string}` | undefined): `0x${string}` {
  assert.ok(payload !== undefined, "expected a report payload");
  return payload;
}

test("valid-pass fixture -> CLEAN_CLOSE, report emitted, amount = 0", async () => {
  const m = makePort({ secret: THRESHOLD, body: validPass });
  const r = await runEvaluation(m.port, CFG, JOB_ID);
  assert.equal(r.action, "REPORTED");
  assert.equal(r.verdict.kind, "CLEAN_CLOSE");
  assert.equal(m.calls.emitReport, 1);
  const d = decode(payloadOf(r.payload));
  assert.equal(d.covered, false);
  assert.equal(d.amount, 0n);
  assert.equal(d.jobId, JOB_ID);
});

test("valid-failure fixture -> PAYOUT, report emitted, amount = guaranteeAmount", async () => {
  const m = makePort({ secret: THRESHOLD, body: validFailure });
  const r = await runEvaluation(m.port, CFG, JOB_ID);
  assert.equal(r.action, "REPORTED");
  assert.equal(r.verdict.kind, "PAYOUT");
  assert.equal(m.calls.emitReport, 1);
  const d = decode(payloadOf(r.payload));
  assert.equal(d.covered, true);
  assert.equal(d.amount, GUARANTEE);
  assert.equal(d.jobId, JOB_ID);
});

test("invalid-commit fixture -> REFUSE COMMIT_MISMATCH, NO report", async () => {
  const m = makePort({ secret: THRESHOLD, body: invalidCommit });
  const r = await runEvaluation(m.port, CFG, JOB_ID);
  assert.equal(r.action, "REFUSED");
  assert.deepEqual(r.verdict, { kind: "REFUSE", reason: "COMMIT_MISMATCH" });
  assert.equal(m.calls.emitReport, 0);
  assert.equal(r.payload, undefined);
});

test("timeout-error fixture (malformed) -> REFUSE MALFORMED_RESPONSE, NO report", async () => {
  const m = makePort({ secret: THRESHOLD, body: timeoutError });
  const r = await runEvaluation(m.port, CFG, JOB_ID);
  assert.equal(r.action, "REFUSED");
  assert.deepEqual(r.verdict, { kind: "REFUSE", reason: "MALFORMED_RESPONSE" });
  assert.equal(m.calls.emitReport, 0);
});

test("replay fixture: verdict is bound to the DERIVED jobId, not the response", async () => {
  // The response is well-formed and would PAYOUT; the payload's jobId domain
  // field comes from the caller (log/getJob), so a replayed body cannot retarget.
  const m = makePort({ secret: THRESHOLD, body: replay });
  const otherJobId = 777n;
  const r = await runEvaluation(m.port, CFG, otherJobId);
  assert.equal(r.action, "REPORTED");
  const d = decode(payloadOf(r.payload));
  assert.equal(d.jobId, otherJobId);
  assert.equal((d.hub as string).toLowerCase(), CFG.assuranceHubAddress.toLowerCase());
  assert.equal(d.chainId, BigInt(CFG.chainId));
});

test("fetch failure -> REFUSE FETCH_FAILED, NO report", async () => {
  const m = makePort({ secret: THRESHOLD, fetchOk: false });
  const r = await runEvaluation(m.port, CFG, JOB_ID);
  assert.deepEqual(r.verdict, { kind: "REFUSE", reason: "FETCH_FAILED" });
  assert.equal(m.calls.emitReport, 0);
});

test("missing threshold secret -> REFUSE SECRET_MISSING, NO report", async () => {
  const m = makePort({ secret: undefined, body: validFailure });
  const r = await runEvaluation(m.port, CFG, JOB_ID);
  assert.deepEqual(r.verdict, { kind: "REFUSE", reason: "SECRET_MISSING" });
  assert.equal(m.calls.emitReport, 0);
});

test("empty threshold secret -> REFUSE SECRET_MISSING (not coerced to 0)", async () => {
  const m = makePort({ secret: "   ", body: validFailure });
  const r = await runEvaluation(m.port, CFG, JOB_ID);
  assert.deepEqual(r.verdict, { kind: "REFUSE", reason: "SECRET_MISSING" });
  assert.equal(m.calls.emitReport, 0);
});

test("null job (read failure) -> REFUSE READ_FAILED, NO report", async () => {
  const m = makePort({ job: null, secret: THRESHOLD });
  const r = await runEvaluation(m.port, CFG, JOB_ID);
  assert.deepEqual(r.verdict, { kind: "REFUSE", reason: "READ_FAILED" });
  assert.equal(m.calls.emitReport, 0);
});

test("job not ClaimPending -> REFUSE NOT_CLAIM_PENDING, NO report", async () => {
  const m = makePort({
    job: {
      status: 4,
      guaranteeAmount: GUARANTEE,
      submissionCommitment: SUBMISSION_COMMITMENT,
    },
    secret: THRESHOLD,
  });
  const r = await runEvaluation(m.port, CFG, JOB_ID);
  assert.deepEqual(r.verdict, { kind: "REFUSE", reason: "NOT_CLAIM_PENDING" });
  assert.equal(m.calls.emitReport, 0);
});

test("amount is always in {0, guaranteeAmount} and never derived from passRate", async () => {
  const failure = makePort({ secret: THRESHOLD, body: validFailure });
  const rf = await runEvaluation(failure.port, CFG, JOB_ID);
  assert.equal(decode(payloadOf(rf.payload)).amount, GUARANTEE);

  const pass = makePort({ secret: THRESHOLD, body: validPass });
  const rp = await runEvaluation(pass.port, CFG, JOB_ID);
  assert.equal(decode(payloadOf(rp.payload)).amount, 0n);
});

test("no injected sentinel or passRate leaks into the emitted payload", async () => {
  const cases: ReadonlyArray<{ name: string; body: { passRate: number } }> = [
    { name: "valid-pass", body: validPass },
    { name: "valid-failure", body: validFailure },
    { name: "replay", body: replay },
  ];
  for (const c of cases) {
    const m = makePort({ secret: THRESHOLD, body: c.body });
    const r = await runEvaluation(m.port, CFG, JOB_ID);
    const payload = payloadOf(r.payload).toLowerCase();
    assert.equal(
      payload.includes(SENTINEL_TOKEN.toLowerCase()),
      false,
      `${c.name}: token sentinel leaked into payload`,
    );
    // passRate (e.g. "0.42") must not appear as a substring of the hex payload.
    assert.equal(
      payload.includes(String(c.body.passRate)),
      false,
      `${c.name}: passRate leaked into payload`,
    );
  }
});
