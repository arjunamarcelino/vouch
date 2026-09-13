/**
 * seed-demo-job.mjs — create a fresh funded AssuranceHub job whose PROVIDER is an address YOU control,
 * and optionally drive it through the lifecycle. Fixes the "provider is a wallet I don't hold" problem
 * on jobs 5-8 (their provider 0x827A7342… is frozen at openJob).
 *
 * Runs locally with YOUR keys — this repo/assistant never sees them. Each leg needs the right signer:
 *   openJob            → CLIENT_PK        (client; must differ from provider — contract rejects self-dealing)
 *   acceptJob+submit   → PROVIDER_PK      (a provider wallet you control, funded with USDC for collateral)
 *   evaluate(approve)  → OPERATOR_PK      (the EVALUATOR — the operator EOA 0x9A39bC…)
 *   openClaim          → CLIENT_PK
 * Then settle to ClaimPaid with scripts/finalize-claim.mjs (needs the forwarder key = operator 0x9A39bC…).
 *
 * Usage:
 *   CLIENT_PK=0x.. PROVIDER=0xYourProviderAddr TARGET=funded node scripts/seed-demo-job.mjs
 *   CLIENT_PK=0x.. PROVIDER_PK=0x.. OPERATOR_PK=0x.. TARGET=claimpending node scripts/seed-demo-job.mjs
 *
 * TARGET (how far to drive): funded | accepted | submitted | approved | claimpending   (default: funded)
 * Amounts are USDC base units (6 dp). Defaults: TASK_FEE=1000000 (1), GUARANTEE=1000000 (1), SERVICE_FEE=0.
 */
import { createRequire } from "node:module";
const require = createRequire("/Users/arjuna/Documents/vouch/packages/cre-workflow/package.json");
const { createPublicClient, createWalletClient, http, getAddress, keccak256, toBytes, decodeEventLog } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const RPC = (process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.io").trim();
const HUB = getAddress((process.env.ASSURANCE_HUB ?? "0xB30e054557533f28753B4ACdf646B393E2072bf9").trim());
const USDC = getAddress((process.env.ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000").trim());
const TARGET = (process.env.TARGET ?? "funded").toLowerCase();
const ORDER = ["funded", "accepted", "submitted", "approved", "claimpending"];
if (!ORDER.includes(TARGET)) throw new Error(`TARGET must be one of ${ORDER.join(", ")}`);
const want = (s) => ORDER.indexOf(TARGET) >= ORDER.indexOf(s);

const TASK_FEE = BigInt(process.env.TASK_FEE ?? 1_000_000n);
const GUARANTEE = BigInt(process.env.GUARANTEE ?? 1_000_000n);
const SERVICE_FEE = BigInt(process.env.SERVICE_FEE ?? 0n);
const COVERAGE = BigInt(process.env.COVERAGE_DURATION ?? 3600n); // 1h (>= MIN_COVERAGE)
const PUB_HASH = keccak256(toBytes("vouch-demo-public"));
const PRIV_COMMIT = keccak256(toBytes("vouch-demo-private"));
const SUBMIT_COMMIT = keccak256(toBytes("vouch-demo-submission"));
const EVIDENCE = keccak256(toBytes("vouch-demo-evidence"));

const arc = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const erc20 = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
];
const hubAbi = [
  { name: "openJob", type: "function", stateMutability: "nonpayable", inputs: [
    { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
    { type: "uint64" }, { type: "uint64" }, { type: "bytes32" }, { type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { name: "acceptJob", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { name: "submitDeliverable", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "bytes32" }], outputs: [] },
  { name: "resolveInitialEvaluation", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "bool" }], outputs: [] },
  { name: "openClaim", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "bytes32" }], outputs: [] },
  { type: "event", name: "JobCreated", inputs: [
    { indexed: true, name: "jobId", type: "uint256" }, { indexed: true, name: "client", type: "address" },
    { indexed: true, name: "provider", type: "address" }, { name: "paymentToken", type: "address" },
    { name: "taskFee", type: "uint256" }, { name: "guaranteeAmount", type: "uint256" }, { name: "serviceFee", type: "uint256" },
    { name: "submissionDeadline", type: "uint64" }, { name: "coverageDuration", type: "uint64" },
    { name: "publicCriteriaHash", type: "bytes32" }, { name: "privateCriteriaCommitment", type: "bytes32" }] },
];

const pub = createPublicClient({ chain: arc, transport: http(RPC) });
const acct = (pk) => (pk ? privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`) : null);
const wallet = (a) => createWalletClient({ account: a, chain: arc, transport: http(RPC) });
const need = (v, msg) => { if (!v) throw new Error(msg); return v; };

const client = need(acct(process.env.CLIENT_PK), "set CLIENT_PK");
const providerAcct = acct(process.env.PROVIDER_PK);
const operator = acct(process.env.OPERATOR_PK);
const providerAddr = getAddress(process.env.PROVIDER ?? (providerAcct ? providerAcct.address : (() => { throw new Error("set PROVIDER (address) or PROVIDER_PK"); })()));
if (getAddress(client.address) === providerAddr) throw new Error("client == provider → contract reverts SelfDealing. Use two different wallets.");

async function send(a, fn, args, value) {
  const hash = await wallet(a).writeContract({ address: value?.to ?? HUB, abi: value?.abi ?? hubAbi, functionName: fn, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${fn}: ${hash} (${r.status})`);
  return r;
}

console.log(`\nSeeding job on Arc → TARGET=${TARGET}`);
console.log(`  client=${client.address}  provider=${providerAddr}  task=${TASK_FEE} guarantee=${GUARANTEE} service=${SERVICE_FEE}`);

// 1) client approves hub for taskFee+serviceFee, then openJob
const fund = TASK_FEE + SERVICE_FEE;
const cliBal = await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [client.address] });
if (cliBal < fund) throw new Error(`client USDC balance ${cliBal} < needed ${fund} (fund the client wallet from the faucet)`);
const cliAllow = await pub.readContract({ address: USDC, abi: erc20, functionName: "allowance", args: [client.address, HUB] });
if (cliAllow < fund) await send(client, "approve", [HUB, fund], { to: USDC, abi: erc20 });
const deadline = (await pub.getBlock()).timestamp + 86400n; // +1 day
const rc = await send(client, "openJob", [providerAddr, USDC, TASK_FEE, GUARANTEE, SERVICE_FEE, deadline, COVERAGE, PUB_HASH, PRIV_COMMIT]);
let jobId;
for (const log of rc.logs) {
  try { const d = decodeEventLog({ abi: hubAbi, data: log.data, topics: log.topics }); if (d.eventName === "JobCreated") { jobId = d.args.jobId; break; } } catch {}
}
console.log(`  → jobId = ${jobId} (Funded)`);

// 2) provider accepts (needs collateral + PROVIDER_PK)
if (want("accepted")) {
  const p = need(providerAcct, "TARGET>=accepted needs PROVIDER_PK");
  const pBal = await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [p.address] });
  if (pBal < GUARANTEE) throw new Error(`provider USDC ${pBal} < guarantee ${GUARANTEE} (fund the provider wallet)`);
  const pAllow = await pub.readContract({ address: USDC, abi: erc20, functionName: "allowance", args: [p.address, HUB] });
  if (pAllow < GUARANTEE) await send(p, "approve", [HUB, GUARANTEE], { to: USDC, abi: erc20 });
  await send(p, "acceptJob", [jobId]);
  console.log(`  → AcceptedByProvider`);
}
// 3) provider submits deliverable
if (want("submitted")) { await send(need(providerAcct, "needs PROVIDER_PK"), "submitDeliverable", [jobId, SUBMIT_COMMIT]); console.log(`  → Submitted`); }
// 4) evaluator approves (fee releases + coverage opens)
if (want("approved")) { await send(need(operator, "TARGET>=approved needs OPERATOR_PK (evaluator)"), "resolveInitialEvaluation", [jobId, true]); console.log(`  → InitiallyApproved (coverage open)`); }
// 5) client opens claim
if (want("claimpending")) { await send(client, "openClaim", [jobId, EVIDENCE]); console.log(`  → ClaimPending`); }

console.log(`\nDone. jobId=${jobId}. Settle the payout:`);
console.log(`  ASSURANCE_HUB=${HUB} JOB_ID=${jobId} RELAY_PRIVATE_KEY=0x<operator-forwarder-pk> node scripts/finalize-claim.mjs`);
