#!/usr/bin/env node
// Predeploy guard (013, hardened by todo 082): refuse to deploy against the 0x0 placeholder address
// or startBlock 0. A subgraph pinned to 0x0 indexes nothing yet reports healthy _meta, so the
// freshness gate would treat every provider as a quotable "new provider" over a phantom-empty index.
// startBlock 0 also forces a full-chain scan.
//
// AUTHORITATIVE SOURCE = subgraph.yaml. `deploy:studio` runs `graph deploy` with NO `--network`
// flag, so graph-cli never injects networks.json — the manifest (subgraph.yaml) is what actually
// ships. This guard therefore validates the manifest, and additionally asserts networks.json is in
// sync with it so the two can never silently diverge on a redeploy. Usage: node scripts/preflight.mjs [network]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const network = process.argv[2] ?? process.env.SUBGRAPH_NETWORK ?? "arc-testnet";
const ZERO = "0x0000000000000000000000000000000000000000";
const root = join(here, "..");

function fail(msg) {
  console.error(`✗ PREFLIGHT FAILED: ${msg}`);
  process.exit(1);
}

// --- Parse the deployed manifest (subgraph.yaml is what `graph deploy` ships) ---
let manifest;
try {
  manifest = readFileSync(join(root, "subgraph.yaml"), "utf8");
} catch (err) {
  fail(`cannot read subgraph.yaml: ${err instanceof Error ? err.message : String(err)}`);
}

// Scope to the AssuranceHub dataSource, then read the first address/startBlock in its `source:` block.
const dsIdx = manifest.indexOf("name: AssuranceHub");
if (dsIdx === -1) fail("subgraph.yaml has no `name: AssuranceHub` dataSource");
const dsBody = manifest.slice(dsIdx);
const addrMatch = dsBody.match(/address:\s*["']?(0x[a-fA-F0-9]{40})["']?/);
const blockMatch = dsBody.match(/startBlock:\s*(\d+)/);
if (!addrMatch) fail("subgraph.yaml AssuranceHub source has no readable `address`");
if (!blockMatch) fail("subgraph.yaml AssuranceHub source has no readable `startBlock`");
const manifestAddress = addrMatch[1];
const manifestStartBlock = Number(blockMatch[1]);

if (manifestAddress.toLowerCase() === ZERO) {
  fail("subgraph.yaml AssuranceHub address is the 0x0 placeholder — set the deployed address first");
}
if (!Number.isInteger(manifestStartBlock) || manifestStartBlock <= 0) {
  fail(`subgraph.yaml startBlock must be a positive deploy block (got ${manifestStartBlock})`);
}

// --- Cross-check networks.json is in sync with the manifest (drift guard) ---
let networks;
try {
  networks = JSON.parse(readFileSync(join(root, "networks.json"), "utf8"));
} catch (err) {
  fail(`cannot read networks.json: ${err instanceof Error ? err.message : String(err)}`);
}
const entry = networks[network] && networks[network].AssuranceHub;
if (!entry) fail(`no AssuranceHub entry for network '${network}' in networks.json`);
if (!entry.address || entry.address.toLowerCase() !== manifestAddress.toLowerCase()) {
  fail(
    `networks.json address (${entry.address}) is out of sync with subgraph.yaml (${manifestAddress}) ` +
      `for '${network}' — update both to the same deployed address`,
  );
}
if (entry.startBlock !== manifestStartBlock) {
  fail(
    `networks.json startBlock (${entry.startBlock}) is out of sync with subgraph.yaml ` +
      `(${manifestStartBlock}) for '${network}'`,
  );
}

console.log(
  `✓ PREFLIGHT OK  network=${network} address=${manifestAddress} startBlock=${manifestStartBlock} (manifest ⇄ networks.json in sync)`,
);
process.exit(0);
