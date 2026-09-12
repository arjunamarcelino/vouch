#!/usr/bin/env node
// Pre-demo health check for the Vouch monorepo (plan WF / feature request), wired as `pnpm demo:health`.
//
// Prints a green / amber / red matrix across all three sponsor tracks, HONESTLY:
//   🟢 OK          — probed and healthy
//   🟡 not configured / skipped — no creds/env for this leg (expected in CI / a partial demo)
//   🔴 MISCONFIGURED — configured but broken (unreachable, wrong chain, 0x0-as-real, indexing errors)
//
// Exit code: non-zero ONLY when something is RED (a configured integration is broken). Absent
// credentials are never a failure — this mirrors the repo's "explicit not-configured state" rule and
// never fakes success. Read-only: it makes RPC/HTTP probes, never a transaction.
//
// Usage:  pnpm demo:health   (loads process.env; source your .env first). Requires Node >=18 (global fetch).
// Env consulted (all optional): ARC_RPC_URL, ARC_CHAIN_ID (default 5042002), VOUCH_CORE_ADDRESS,
//   QUOTE_BOND_ESCROW_ADDRESS, USDC_ADDRESS, SUBGRAPH_URL, AGENT_URL, API_URL (or NEXT_PUBLIC_API_BASE_URL).

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Anchor to the repo root relative to this script so behavior is cwd-independent (house pattern).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const rows = [];
let red = 0;

const OK = "🟢 OK";
const NA = "🟡 n/a";
const BAD = "RED";
function row(track, check, status, detail) {
  rows.push({ track, check, status, detail: detail || "" });
  if (status === BAD) red++;
}

const TIMEOUT_MS = 5000;
// Single fetch-with-timeout helper (DRY — was duplicated three times).
async function fetchWithTimeout(url, init = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}
async function rpc(url, method, params = []) {
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
}
async function gql(url, query) {
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return await res.json();
}
async function httpOk(url) {
  try {
    const res = await fetchWithTimeout(url);
    return res.ok;
  } catch {
    return false;
  }
}

const isAddrShape = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
const isZeroAddr = (a) => !a || /^0x0{40}$/i.test(a);
// Redact credential-bearing URLs (RPC/subgraph providers often embed the key in the path/query).
function redact(u) {
  try {
    const { protocol, host } = new URL(u);
    return `${protocol}//${host}/…`;
  } catch {
    return "(url)";
  }
}

async function main() {
  if (typeof fetch !== "function") {
    console.error("demo:health requires Node >=18 (global fetch). Upgrade Node and retry.");
    process.exit(1);
  }

  // ---- static (always runnable) ----
  row(
    "repo",
    "contracts built (out/)",
    existsSync(join(ROOT, "packages/contracts/out")) ? OK : NA,
    "run: pnpm --filter @vouch/contracts build",
  );
  row(
    "repo",
    "web build (.next)",
    existsSync(join(ROOT, "apps/web/.next")) ? OK : NA,
    "run: pnpm --filter @vouch/web build",
  );
  // CRE fixtures are COMMITTED artifacts, so their absence is a real breakage (RED), unlike the
  // credential/build legs where absence is an expected 🟡.
  row(
    "chainlink",
    "CRE fixtures present",
    ["valid-failure", "valid-pass", "invalid-commit", "replay", "timeout-error"].every((f) =>
      existsSync(join(ROOT, `packages/cre-workflow/fixtures/${f}.json`)),
    )
      ? OK
      : BAD,
    "harness: pnpm --filter @vouch/cre-workflow simulate:harness fixtures/<f>.json",
  );

  // ---- Arc chain (Arc / Circle track) ----
  const arcRpc = env.ARC_RPC_URL;
  const wantChain = Number(env.ARC_CHAIN_ID || 5042002);
  if (!arcRpc) {
    row("arc", "RPC reachable", NA, "set ARC_RPC_URL");
  } else {
    try {
      const cid = parseInt(await rpc(arcRpc, "eth_chainId"), 16);
      if (cid === wantChain) row("arc", "RPC + chainId", OK, `chainId ${cid} · ${redact(arcRpc)}`);
      else row("arc", "RPC + chainId", BAD, `chainId ${cid} != expected ${wantChain}`);
    } catch (e) {
      row("arc", "RPC reachable", BAD, `unreachable: ${(e.message || "").slice(0, 40)}`);
    }
    for (const [name, addr] of [
      ["AssuranceHub", env.VOUCH_CORE_ADDRESS],
      ["QuoteBondEscrow", env.QUOTE_BOND_ESCROW_ADDRESS],
      ["USDC", env.USDC_ADDRESS],
    ]) {
      if (!addr) {
        row("arc", `${name} address`, NA, "unset");
      } else if (isZeroAddr(addr)) {
        row("arc", `${name} address`, BAD, "0x0 placeholder presented as deployed");
      } else if (!isAddrShape(addr)) {
        row("arc", `${name} address`, BAD, `malformed address: ${addr.slice(0, 12)}…`);
      } else {
        try {
          const code = await rpc(arcRpc, "eth_getCode", [addr, "latest"]);
          row(
            "arc",
            `${name} bytecode`,
            code && code !== "0x" ? OK : BAD,
            code && code !== "0x" ? addr : `${addr} has NO code`,
          );
        } catch {
          row("arc", `${name} bytecode`, BAD, "eth_getCode failed");
        }
      }
    }
  }

  // ---- The Graph ----
  const subUrl = env.SUBGRAPH_URL;
  if (!subUrl) {
    row("graph", "subgraph freshness", NA, "set SUBGRAPH_URL");
  } else {
    try {
      const j = await gql(subUrl, "{ _meta { block { number } hasIndexingErrors deployment } }");
      if (j?.errors?.length) {
        row("graph", "subgraph query", BAD, `graphql error: ${(j.errors[0].message || "").slice(0, 40)}`);
      } else {
        const meta = j?.data?._meta;
        if (!meta) row("graph", "subgraph _meta", BAD, "no _meta (bad endpoint?)");
        else if (meta.hasIndexingErrors) row("graph", "subgraph indexing", BAD, "hasIndexingErrors=true");
        else row("graph", "subgraph indexing", OK, `indexed block ${meta.block?.number}`);
      }
    } catch (e) {
      row("graph", "subgraph reachable", BAD, `unreachable: ${(e.message || "").slice(0, 40)}`);
    }
  }

  // ---- services ----
  for (const [track, label, base] of [
    ["arc", "agent /health", env.AGENT_URL],
    ["arc", "api /health", env.API_URL || env.NEXT_PUBLIC_API_BASE_URL],
  ]) {
    if (!base) row(track, label, NA, "service URL unset");
    else row(track, label, (await httpOk(base.replace(/\/$/, "") + "/health")) ? OK : BAD, redact(base));
  }

  // ---- report ----
  const pad = (s, n) => String(s).padEnd(n);
  console.log("\n── Vouch pre-demo health ──  (🟢 ok · 🟡 not configured · 🔴 misconfigured)\n");
  console.log(`  ${pad("TRACK", 10)}${pad("CHECK", 26)}STATUS   DETAIL`);
  for (const r of rows) {
    const s = r.status === BAD ? "🔴 RED" : r.status;
    console.log(`  ${pad(r.track, 10)}${pad(r.check, 26)}${pad(s, 9)}${r.detail}`);
  }
  const greens = rows.filter((r) => r.status === OK).length;
  const nas = rows.filter((r) => r.status === NA).length;
  console.log(`\n  ${greens} ok · ${nas} not-configured · ${red} misconfigured`);
  if (red) {
    console.error("\ndemo:health FAILED — a configured integration is broken (see 🔴 above).");
    process.exit(1);
  }
  console.log("\ndemo:health OK — nothing configured is broken (unconfigured legs are expected).");
}

main().catch((e) => {
  console.error(`demo:health crashed: ${e.stack || e.message || e}`);
  process.exit(1);
});
