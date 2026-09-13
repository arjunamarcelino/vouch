/**
 * finalize-claim.mjs — deliver the DON-signed 7-tuple verdict to AssuranceHub.onReport,
 * settling a ClaimPending job to ClaimPaid (covered payout to the client).
 *
 * This is the TRUSTED-EOA-RELAY leg (Arc testnet has no canonical KeystoneForwarder). It reads the
 * expected workflow identity + forwarder + the job straight from chain — nothing is hard-coded — so
 * the metadata/report it builds is correct by construction. It NEVER invents chain results: with no
 * RELAY_PRIVATE_KEY it only prints a ready-to-paste `cast send`; with one it broadcasts and reports
 * the real tx hash.
 *
 * Usage (read-only, prints the cast command):
 *   ASSURANCE_HUB=0x... JOB_ID=4 node scripts/finalize-claim.mjs
 * Usage (broadcast — the relay key MUST be the on-chain `forwarder` EOA):
 *   ASSURANCE_HUB=0x... JOB_ID=4 RELAY_PRIVATE_KEY=0x... node scripts/finalize-claim.mjs
 *
 * Optional overrides: COVERED=false | AMOUNT=<uint> | EVIDENCE_COMMITMENT=0x<32b>
 */
import { createRequire } from "node:module";
const require = createRequire("/Users/arjuna/Documents/vouch/packages/cre-workflow/package.json");
const {
  createPublicClient, createWalletClient, http,
  encodeAbiParameters, encodePacked, getAddress,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const RPC = (process.env.ARC_TESTNET_RPC_URL ?? process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io").trim();
const HUB = getAddress((process.env.ASSURANCE_HUB ?? "0xB30e054557533f28753B4ACdf646B393E2072bf9").trim());
const JOB_ID = BigInt(process.env.JOB_ID ?? (() => { throw new Error("set JOB_ID"); })());
const COVERED = (process.env.COVERED ?? "true").toLowerCase() !== "false";

const arc = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };

const jobTuple = { type: "tuple", components: [
  { name: "client", type: "address" }, { name: "provider", type: "address" },
  { name: "taskFee", type: "uint256" }, { name: "guaranteeAmount", type: "uint256" },
  { name: "serviceFee", type: "uint256" }, { name: "publicCriteriaHash", type: "bytes32" },
  { name: "privateCriteriaCommitment", type: "bytes32" }, { name: "submissionCommitment", type: "bytes32" },
  { name: "claimEvidenceCommitment", type: "bytes32" }, { name: "submissionDeadline", type: "uint64" },
  { name: "coverageDuration", type: "uint64" }, { name: "coverageEnd", type: "uint64" },
  { name: "claimResolutionDeadline", type: "uint64" }, { name: "status", type: "uint8" },
] };
const abi = [
  { name: "getJob", type: "function", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [jobTuple] },
  { name: "forwarder", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "expectedWorkflowId", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { name: "expectedWorkflowName", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bytes10" }] },
  { name: "expectedWorkflowOwner", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "onReport", type: "function", stateMutability: "nonpayable", inputs: [{ name: "metadata", type: "bytes" }, { name: "report", type: "bytes" }], outputs: [] },
];

const pub = createPublicClient({ chain: arc, transport: http(RPC) });

const [job, forwarder, wfId, wfName, wfOwner, block] = await Promise.all([
  pub.readContract({ address: HUB, abi, functionName: "getJob", args: [JOB_ID] }),
  pub.readContract({ address: HUB, abi, functionName: "forwarder" }),
  pub.readContract({ address: HUB, abi, functionName: "expectedWorkflowId" }),
  pub.readContract({ address: HUB, abi, functionName: "expectedWorkflowName" }),
  pub.readContract({ address: HUB, abi, functionName: "expectedWorkflowOwner" }),
  pub.getBlock(),
]);

if (Number(job.status) !== 5) {
  throw new Error(`job ${JOB_ID} is in state ${job.status}, not ClaimPending(5). Open a claim first (openClaim).`);
}
const amount = COVERED ? BigInt(process.env.AMOUNT ?? job.guaranteeAmount) : 0n;
if (COVERED && (amount === 0n || amount > job.guaranteeAmount)) throw new Error(`AMOUNT must be 0 < amount <= guarantee(${job.guaranteeAmount})`);
const evidence = (process.env.EVIDENCE_COMMITMENT ?? job.claimEvidenceCommitment);
if (!/^0x[0-9a-fA-F]{64}$/.test(evidence) || /^0x0+$/.test(evidence)) throw new Error("evidenceCommitment must be a non-zero 32-byte hex");
const evaluatedAt = block.timestamp; // within EVAL_TIMESTAMP_SKEW (5 min) of on-chain time

// metadata: abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner) = 62 bytes
const metadata = encodePacked(["bytes32", "bytes10", "address"], [wfId, wfName, wfOwner]);
// report: abi.encode(uint256 chainId, address hub, uint256 jobId, bool covered, uint256 amount, bytes32 evidenceCommitment, uint64 evaluatedAt)
const report = encodeAbiParameters(
  [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint64" }],
  [BigInt(arc.id), HUB, JOB_ID, COVERED, amount, evidence, evaluatedAt],
);

console.log(`\nJob ${JOB_ID}: client=${job.client} provider=${job.provider} guarantee=${job.guaranteeAmount}`);
console.log(`Verdict: covered=${COVERED} amount=${amount} evidenceCommitment=${evidence} evaluatedAt=${evaluatedAt}`);
console.log(`On-chain forwarder (must sign): ${forwarder}`);
console.log(`\nmetadata (${(metadata.length - 2) / 2} bytes):\n  ${metadata}`);
console.log(`\nreport (${(report.length - 2) / 2} bytes):\n  ${report}`);
console.log(`\n--- Option A: paste this cast command (relay key = forwarder EOA) ---`);
console.log(`cast send ${HUB} "onReport(bytes,bytes)" ${metadata} ${report} \\\n  --private-key <relay-pk> --rpc-url arc_testnet`);

const relayPk = process.env.RELAY_PRIVATE_KEY;
if (!relayPk) {
  console.log(`\n(no RELAY_PRIVATE_KEY set — not broadcasting. Set it to send from here.)`);
  process.exit(0);
}
const account = privateKeyToAccount(relayPk.startsWith("0x") ? relayPk : `0x${relayPk}`);
if (getAddress(account.address) !== getAddress(forwarder)) {
  throw new Error(`RELAY_PRIVATE_KEY address ${account.address} != on-chain forwarder ${forwarder}. onReport would revert NotForwarder.`);
}
const wallet = createWalletClient({ account, chain: arc, transport: http(RPC) });
console.log(`\nBroadcasting onReport from ${account.address} ...`);
const hash = await wallet.writeContract({ address: HUB, abi, functionName: "onReport", args: [metadata, report] });
console.log(`tx: ${hash}`);
const rcpt = await pub.waitForTransactionReceipt({ hash });
const after = await pub.readContract({ address: HUB, abi, functionName: "getJob", args: [JOB_ID] });
console.log(`status: ${rcpt.status}  job now in state ${after.status} ${Number(after.status) === 6 ? "= ClaimPaid ✅" : ""}`);
console.log(`explorer: https://testnet.arcscan.app/tx/${hash}`);
