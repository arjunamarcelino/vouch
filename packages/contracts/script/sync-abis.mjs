#!/usr/bin/env node
/**
 * sync-abis.mjs — ABI single source of truth (plan §18.4 H1).
 *
 * Reads the Foundry ABI artifact (out/AssuranceHub.sol/AssuranceHub.json, produced by
 * `forge build` with `extra_output_files = ["abi"]`) and writes BOTH consumers from the one
 * artifact so contract↔subgraph drift is impossible:
 *   1. packages/shared/src/abis/assuranceHub.ts  — `export const assuranceHubAbi = (...) as const`
 *      (viem keeps full type inference).
 *   2. packages/subgraph/abis/AssuranceHub.json  — raw ABI JSON for graph-cli codegen.
 *
 * The Foundry build ABI is authoritative; both outputs are regenerated, never edited by hand.
 * Run: `pnpm --filter @vouch/contracts abi:sync`.
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Write atomically: write to a temp sibling then rename, so a mid-run failure can't leave a
 *  half-written (drifted) artifact (finding 013). */
function writeAtomic(path, contents) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, contents, "utf8");
  renameSync(tmp, path);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsRoot = resolve(__dirname, "..");
const repoRoot = resolve(contractsRoot, "..", "..");

const ARTIFACT = resolve(contractsRoot, "out/AssuranceHub.sol/AssuranceHub.json");
const TS_OUT = resolve(repoRoot, "packages/shared/src/abis/assuranceHub.ts");
const JSON_OUT = resolve(repoRoot, "packages/subgraph/abis/AssuranceHub.json");

function main() {
  let raw;
  try {
    raw = readFileSync(ARTIFACT, "utf8");
  } catch {
    console.error(`[sync-abis] Could not read ${ARTIFACT}.\nRun \`forge build\` in packages/contracts first.`);
    process.exit(1);
  }

  let artifact;
  try {
    artifact = JSON.parse(raw);
  } catch (e) {
    console.error(
      `[sync-abis] ${ARTIFACT} is not valid JSON (truncated/interrupted build?).\n` +
        `Re-run \`forge build\` in packages/contracts. (${e.message})`,
    );
    process.exit(1);
  }
  const abi = artifact.abi ?? artifact;
  if (!Array.isArray(abi)) {
    console.error("[sync-abis] Artifact has no `abi` array.");
    process.exit(1);
  }

  const banner =
    "/**\n" +
    " * AssuranceHub ABI — GENERATED from the Foundry build. DO NOT EDIT BY HAND.\n" +
    " *\n" +
    " * Source of truth: packages/contracts/out/AssuranceHub.sol/AssuranceHub.json\n" +
    " * Regenerate: `pnpm --filter @vouch/contracts abi:sync`\n" +
    " *\n" +
    " * Emitted as `.ts as const` so viem keeps full function/arg type inference.\n" +
    " * The CRE report is `abi.decode(report, (uint256 chainId, address hub, uint256 jobId, bool covered, uint256 amount, bytes32 evidenceCommitment, uint64 evaluatedAt))`.\n" +
    " */\n";
  const tsBody = `export const assuranceHubAbi = ${JSON.stringify(abi, null, 2)} as const;\n`;

  mkdirSync(dirname(TS_OUT), { recursive: true });
  writeAtomic(TS_OUT, banner + tsBody);
  console.log(`[sync-abis] Wrote ${TS_OUT} (${abi.length} ABI entries).`);

  mkdirSync(dirname(JSON_OUT), { recursive: true });
  writeAtomic(JSON_OUT, `${JSON.stringify(abi, null, 2)}\n`);
  console.log(`[sync-abis] Wrote ${JSON_OUT} (${abi.length} ABI entries).`);
}

main();
