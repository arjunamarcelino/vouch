#!/usr/bin/env node
// Indexing-lag health check for the deployed Vouch subgraph (plan §7). Fails CLOSED at the ops layer:
// any transport error, indexing error, deployment mismatch, or lag over budget → non-zero exit.
// Config from env — no hard-coded secrets. Prints latest indexed block + lag. Redacts keyed URLs.

const SUBGRAPH_URL = process.env.SUBGRAPH_URL;
const STATUS_URL = process.env.SUBGRAPH_STATUS_URL;
const RPC_URL = process.env.ARC_RPC_URL;
const DEPLOYMENT_ID = process.env.SUBGRAPH_DEPLOYMENT_ID;
const MAX_LAG = BigInt(process.env.SUBGRAPH_MAX_LAG_BLOCKS ?? "25");
const TIMEOUT_MS = Number(process.env.SUBGRAPH_TIMEOUT_MS ?? "10000");

function redact(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

function fail(msg) {
  console.error(`✗ UNHEALTHY: ${msg}`);
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

async function gql(url, query, variables = {}) {
  const body = await post(url, { query, variables });
  if (body.errors) throw new Error(`GraphQL errors (${redact(url)}): ${JSON.stringify(body.errors)}`);
  return body.data;
}

async function chainHeadFromRpc() {
  const body = await post(RPC_URL, { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
  if (!body.result) throw new Error("RPC returned no result for eth_blockNumber");
  return BigInt(body.result);
}

async function main() {
  if (!SUBGRAPH_URL) fail("SUBGRAPH_URL not set");

  const meta = await gql(
    SUBGRAPH_URL,
    `{ _meta { block { number timestamp } deployment hasIndexingErrors } }`,
  );
  const m = meta._meta;
  if (!m) fail("subgraph returned no _meta");
  if (m.hasIndexingErrors) fail("subgraph reports indexing errors");
  if (DEPLOYMENT_ID && m.deployment !== DEPLOYMENT_ID) {
    fail(`deployment mismatch: got ${m.deployment}, expected ${DEPLOYMENT_ID}`);
  }
  const latestIndexed = BigInt(m.block.number);

  // Chain head: prefer the index-node status API (authoritative chainHeadBlock); else RPC.
  let chainHead;
  if (STATUS_URL) {
    const data = await gql(
      STATUS_URL,
      `query($id: String!) {
        indexingStatuses(subgraphs: [$id]) {
          synced health
          fatalError { message }
          chains { chainHeadBlock { number } latestBlock { number } }
        }
      }`,
      { id: m.deployment },
    );
    const s = data.indexingStatuses && data.indexingStatuses[0];
    if (!s) fail("no indexing status for this deployment");
    if (s.health !== "healthy") fail(`subgraph health is '${s.health}'`);
    if (s.fatalError) fail(`fatal indexing error: ${s.fatalError.message}`);
    if (!s.synced) fail("subgraph is not synced");
    chainHead = BigInt(s.chains[0].chainHeadBlock.number);
  } else if (RPC_URL) {
    chainHead = await chainHeadFromRpc();
  } else {
    fail("neither SUBGRAPH_STATUS_URL nor ARC_RPC_URL set — cannot determine chain head");
  }

  const lag = chainHead - latestIndexed;
  if (lag < 0n) fail(`chain head (${chainHead}) is behind the indexed block (${latestIndexed})`);
  if (lag > MAX_LAG) fail(`indexing lag ${lag} blocks exceeds max ${MAX_LAG}`);

  console.log(
    `✓ HEALTHY  endpoint=${redact(SUBGRAPH_URL)} deployment=${m.deployment} ` +
      `latestIndexedBlock=${latestIndexed} chainHead=${chainHead} lag=${lag} (max ${MAX_LAG})`,
  );
  process.exit(0);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
