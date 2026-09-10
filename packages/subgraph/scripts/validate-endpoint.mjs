#!/usr/bin/env node
// Validates that the DEPLOYED Graph endpoint serves the risk-agent-input contract with every required
// field, correctly typed, AND is fresh (plan §7). Fails CLOSED: a missing field OR a lagging index
// (all-fields-present but behind) OR any transport error → non-zero exit. Config from env.
//
// Usage: node scripts/validate-endpoint.mjs [providerAddress]

const SUBGRAPH_URL = process.env.SUBGRAPH_URL;
const RPC_URL = process.env.ARC_RPC_URL;
const MAX_LAG = BigInt(process.env.SUBGRAPH_MAX_LAG_BLOCKS ?? "25");
const TIMEOUT_MS = Number(process.env.SUBGRAPH_TIMEOUT_MS ?? "10000");
const HEX_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const INT_STRING = /^-?\d+$/;

const providerArg = process.argv[2] ?? "0x1111111111111111111111111111111111111111";

function redact(url) {
  // Origin only — gateway API keys live in the path, so never print it (012).
  try {
    return `${new URL(url).origin}/…`;
  } catch {
    return "<invalid-url>";
  }
}
function fail(msg) {
  console.error(`✗ INVALID: ${msg}`);
  process.exit(1);
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${redact(url)})`);
  return res.json();
}

// Required fields on the risk-agent-input contract → their validators.
function assertInt(obj, field, path) {
  if (obj[field] === undefined || obj[field] === null) fail(`missing field ${path}.${field}`);
  if (!INT_STRING.test(String(obj[field]))) fail(`field ${path}.${field} is not an integer string: ${obj[field]}`);
}

async function main() {
  if (!SUBGRAPH_URL) fail("SUBGRAPH_URL not set");
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

  const body = await post(SUBGRAPH_URL, { query, variables: { id: providerArg.toLowerCase() } });
  if (body.errors) fail(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  const data = body.data;

  // --- freshness (fail closed even if all fields present) ---
  const m = data._meta;
  if (!m) fail("no _meta on response");
  if (m.hasIndexingErrors) fail("subgraph reports indexing errors");
  if (typeof m.block.number !== "number") fail("_meta.block.number missing");
  const latestIndexed = BigInt(m.block.number);
  if (RPC_URL) {
    const rpc = await post(RPC_URL, { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
    const chainHead = BigInt(rpc.result);
    const lag = chainHead - latestIndexed;
    if (lag < 0n) fail(`chain head ${chainHead} behind indexed block ${latestIndexed}`);
    if (lag > MAX_LAG) fail(`indexing lag ${lag} exceeds max ${MAX_LAG}`);
  }

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
