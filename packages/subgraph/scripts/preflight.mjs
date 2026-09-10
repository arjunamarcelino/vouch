#!/usr/bin/env node
// Predeploy guard (013): refuse to deploy against the 0x0 placeholder address or startBlock 0.
// A subgraph pinned to 0x0 indexes nothing yet reports healthy _meta, so the freshness gate would
// treat every provider as a quotable "new provider" over a phantom-empty index. startBlock 0 also
// forces a full-chain scan. Reads networks.json; usage: node scripts/preflight.mjs [network]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const network = process.argv[2] ?? process.env.SUBGRAPH_NETWORK ?? "arc-testnet";
const ZERO = "0x0000000000000000000000000000000000000000";

function fail(msg) {
  console.error(`✗ PREFLIGHT FAILED: ${msg}`);
  process.exit(1);
}

let networks;
try {
  networks = JSON.parse(readFileSync(join(here, "..", "networks.json"), "utf8"));
} catch (err) {
  fail(`cannot read networks.json: ${err instanceof Error ? err.message : String(err)}`);
}

const entry = networks[network] && networks[network].AssuranceHub;
if (!entry) fail(`no AssuranceHub entry for network '${network}' in networks.json`);
if (!entry.address || entry.address.toLowerCase() === ZERO) {
  fail(`AssuranceHub address for '${network}' is the 0x0 placeholder — set the deployed address first`);
}
if (!/^0x[a-fA-F0-9]{40}$/.test(entry.address)) fail(`AssuranceHub address for '${network}' is malformed`);
if (!Number.isInteger(entry.startBlock) || entry.startBlock <= 0) {
  fail(`startBlock for '${network}' must be a positive deploy block (got ${entry.startBlock})`);
}

console.log(
  `✓ PREFLIGHT OK  network=${network} address=${entry.address} startBlock=${entry.startBlock}`,
);
process.exit(0);
