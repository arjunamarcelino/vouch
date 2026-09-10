// Shared helpers for the ops scripts (health-check / validate-endpoint) so the freshness / GraphQL /
// redaction / chain-head logic lives in ONE place, not copy-pasted per script (025). Plain ESM so the
// standalone .mjs scripts can import it with no build step.

const DEFAULT_TIMEOUT_MS = Number(process.env.SUBGRAPH_TIMEOUT_MS ?? "10000");

/** Redact to ORIGIN only — gateway API keys live in the URL path, so never print it (012). */
export function redact(url) {
  try {
    return `${new URL(url).origin}/…`;
  } catch {
    return "<invalid-url>";
  }
}

export async function post(url, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${redact(url)})`);
  return res.json();
}

export async function gql(url, query, variables = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const body = await post(url, { query, variables }, timeoutMs);
  if (body.errors) throw new Error(`GraphQL errors (${redact(url)}): ${JSON.stringify(body.errors)}`);
  return body.data;
}

/** Chain head via JSON-RPC eth_blockNumber → BigInt. Throws on any failure. */
export async function chainHead(rpcUrl, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const body = await post(
    rpcUrl,
    { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
    timeoutMs,
  );
  if (!body.result) throw new Error("RPC returned no result for eth_blockNumber");
  return BigInt(body.result);
}
