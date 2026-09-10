#!/usr/bin/env node
/**
 * sync-abis.mjs — regenerates the TS ABI single-source-of-truth for viem/TS consumers.
 *
 * Reads the Foundry ABI artifact (out/VouchCore.sol/VouchCore.json — the object with an
 * `abi` field produced by `forge build` with `extra_output_files = ["abi"]`) and writes
 * packages/shared/src/abis/vouchCore.ts as `export const vouchCoreAbi = (<json>) as const;`
 * so viem keeps full type inference (plan §17.7-1).
 *
 * The Foundry build ABI is the source of truth; the hand-authored TS file is regenerated,
 * never edited by hand. Run: `pnpm --filter @vouch/contracts abi:sync`.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsRoot = resolve(__dirname, "..");
const repoRoot = resolve(contractsRoot, "..", "..");

const ARTIFACT = resolve(contractsRoot, "out/VouchCore.sol/VouchCore.json");
const OUT = resolve(repoRoot, "packages/shared/src/abis/vouchCore.ts");

function main() {
  let raw;
  try {
    raw = readFileSync(ARTIFACT, "utf8");
  } catch {
    console.error(
      `[sync-abis] Could not read ${ARTIFACT}.\n` +
        `Run \`forge build\` in packages/contracts first.`,
    );
    process.exit(1);
  }

  const artifact = JSON.parse(raw);
  const abi = artifact.abi ?? artifact;
  if (!Array.isArray(abi)) {
    console.error("[sync-abis] Artifact has no `abi` array.");
    process.exit(1);
  }

  const banner =
    "/**\n" +
    " * VouchCore ABI — GENERATED from the Foundry build. DO NOT EDIT BY HAND.\n" +
    " *\n" +
    " * Source of truth: packages/contracts/out/VouchCore.sol/VouchCore.json\n" +
    " * Regenerate: `pnpm --filter @vouch/contracts abi:sync`\n" +
    " *\n" +
    " * Emitted as `.ts as const` so viem keeps full function/arg type inference\n" +
    " * (plan §17.7-1). Keep the CRE report decode in lockstep:\n" +
    " *   abi.decode(report, (uint256 jobId, bool regressed, uint256 amount)).\n" +
    " */\n";

  const body = `export const vouchCoreAbi = ${JSON.stringify(abi, null, 2)} as const;\n`;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, banner + body, "utf8");
  console.log(`[sync-abis] Wrote ${OUT} (${abi.length} ABI entries).`);
}

main();
