#!/usr/bin/env node
// Local MOCK of the confidential test-API for a CRE `cre workflow simulate` run against the LIVE
// covered-claim job (jobId 1). Returns a covered-failure body whose commitHash matches job 1's
// on-chain submissionCommitment, so the workflow's decide logic yields PAYOUT.
//
// This is a DEMO stand-in for the real private-test API — it holds no secret and inverts no real
// criteria; it just returns a fixed, public covered-failure result for the demo job.
//
//   node scripts/mock-testapi.mjs   # listens on :8799
//
// Then set config.staging.json testApiUrl = http://127.0.0.1:8799 and run the simulate.
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_TESTAPI_PORT || 8799);
const BODY = JSON.stringify({
  // job 1 submissionCommitment = keccak256("submission|demo|salt")
  commitHash: "0x4a659fdb305943813357143e182a38d0d4e489ac8cb529bf2f49c07544811b75",
  failureCode: "REGRESSION",
  passRate: 0.42, // < PASS_THRESHOLD (0.9) → covered failure → PAYOUT
});

createServer((req, res) => {
  // Respond to any method/path with the covered-failure body (the workflow only reads the JSON body).
  res.writeHead(200, { "content-type": "application/json" });
  res.end(BODY);
  console.log(`${new Date().toISOString()} ${req.method} ${req.url} -> 200 covered-failure`);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`mock test-API listening on http://127.0.0.1:${PORT} (covered-failure for jobId 1)`);
});
