#!/usr/bin/env node
// Validates that the DEPLOYED Graph endpoint serves the risk-agent-input contract with every required
// field, correctly typed, AND is fresh (plan §7). Fails CLOSED: a missing field OR a lagging index
// (all-fields-present but behind) OR any transport error → non-zero exit. Config from env.
//
// Usage: node scripts/validate-endpoint.mjs [providerAddress]

import { redact, gql, chainHead as chainHeadFromRpc } from "./_graph.mjs";

const SUBGRAPH_URL = process.env.SUBGRAPH_URL;
const RPC_URL = process.env.ARC_RPC_URL;
const MAX_LAG = BigInt(process.env.SUBGRAPH_MAX_LAG_BLOCKS ?? "25");
const HEX_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const INT_STRING = /^-?\d+$/;

const providerArg = process.argv[2] ?? "0x1111111111111111111111111111111111111111";

function fail(msg) {
  console.error(`✗ INVALID: ${msg}`);
  process.exit(1);
}

// Required fields on the risk-agent-input contract → their validators.
function assertInt(obj, field, path) {
  if (obj[field] === undefined || obj[field] === null) fail(`missing field ${path}.${field}`);
  if (!INT_STRING.test(String(obj[field]))) fail(`field ${path}.${field} is not an integer string: ${obj[field]}`);
}

async function main() {
  if (!SUBGRAPH_URL) fail("SUBGRAPH_URL not set");
  // Fail closed: without a chain-head source we can't verify lag, so an all-fields-present but lagging
  // index would falsely pass. Require ARC_RPC_URL (matches health-check.mjs) (025).
  if (!RPC_URL) fail("ARC_RPC_URL not set — cannot verify indexing lag");
  if (!HEX_ADDRESS.test(providerArg)) fail(`bad provider address: ${providerArg}`);

  // Validate the SHAPE the agent actually reads (denormalized current risk view on Provider + _meta
  // + bounded dailyMetrics) — the same fields as queries/risk-agent-input.graphql (015).
  const query = `
    query Validate($id: ID!) {
      _meta { block { number timestamp } deployment hasIndexingErrors }
      provider(id: $id) {
        id
        jobsCompleted
        totalCoveredAmount
        claimsUpheld
        lastUpheldClaimRateBps
        lastAverageCoverageRatioBps
        lastSampleSize
        lastHasEnoughHistory
        dailyMetrics(orderBy: dayStartTimestamp, orderDirection: desc, first: 5) {
          upheldFailures closedWindows dayStartTimestamp
        }
      }
    }`;

  const data = await gql(SUBGRAPH_URL, query, { id: providerArg.toLowerCase() });

  // --- freshness (fail closed even if all fields present) ---
  const m = data._meta;
  if (!m) fail("no _meta on response");
  if (m.hasIndexingErrors) fail("subgraph reports indexing errors");
  if (typeof m.block.number !== "number") fail("_meta.block.number missing");
  const latestIndexed = BigInt(m.block.number);
  const head = await chainHeadFromRpc(RPC_URL);
  const lag = head - latestIndexed;
  if (lag < 0n) fail(`chain head ${head} behind indexed block ${latestIndexed}`);
  if (lag > MAX_LAG) fail(`indexing lag ${lag} exceeds max ${MAX_LAG}`);

  // --- required-field shape ---
  const p = data.provider;
  if (p === null || p === undefined) {
    // A fresh index with no such provider is a VALID "new provider" response — the schema is present.
    console.log(
      `✓ VALID (new provider — no history)  endpoint=${redact(SUBGRAPH_URL)} ` +
        `deployment=${m.deployment} latestIndexedBlock=${latestIndexed}`,
    );
    process.exit(0);
  }
  if (!HEX_ADDRESS.test(p.id)) fail(`provider.id not an address: ${p.id}`);
  for (const f of [
    "jobsCompleted",
    "totalCoveredAmount",
    "claimsUpheld",
    "lastUpheldClaimRateBps",
    "lastAverageCoverageRatioBps",
    "lastSampleSize",
  ]) {
    assertInt(p, f, "provider");
  }
  if (typeof p.lastHasEnoughHistory !== "boolean") fail("provider.lastHasEnoughHistory is not boolean");
  for (const d of p.dailyMetrics) {
    assertInt(d, "upheldFailures", "dailyMetric");
    assertInt(d, "closedWindows", "dailyMetric");
  }

  console.log(
    `✓ VALID  endpoint=${redact(SUBGRAPH_URL)} deployment=${m.deployment} ` +
      `provider=${p.id} dailyMetrics=${p.dailyMetrics.length} latestIndexedBlock=${latestIndexed}`,
  );
  process.exit(0);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
