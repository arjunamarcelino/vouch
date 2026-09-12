/**
 * Vouch — Chainlink CRE Confidential Workflow (SDK-coupled entry point).
 *
 * This is the ONLY file that imports `@chainlink/cre-sdk`. It wires the real
 * `EvalPort` (from `port.ts`) to the SDK runtime and registers a confidential
 * `handlerInTee` on the AssuranceHub `ClaimOpened` EVM log trigger.
 *
 * Flow (see the plan §6.2):
 *   ClaimOpened log -> jobId from topics[1] -> getJob (REFUSE unless ClaimPending)
 *   -> getSecret(PASS_THRESHOLD) -> ConfidentialHTTPClient fetch ({{.token}})
 *   -> decideVerdict (fail-closed) -> build 7-tuple payload
 *   -> reportFromDon(prepareReportRequest(HEX)) -> writeReport.
 *
 * CONFIDENTIALITY: private tests, criteria, thresholds, and credentials are
 * NEVER inlined. The threshold arrives via `getSecret`; the credential is
 * injected INSIDE the enclave via `{{.token}}` Vault DON templating. We never
 * `runtime.log` a secret-derived value (it would surface in local sim stdout).
 *
 * Note: `callContract` / `writeReport` / `sendRequest` are typed for
 * `Runtime<unknown>` (they route OUTSIDE the TEE), so they are called via
 * `rt.usingTheDons()`. `getSecret` and `reportFromDon` are on `TeeRuntime`.
 */
import {
  ConfidentialHTTPClient,
  EVMClient,
  getNetwork,
  handlerInTee,
  json,
  LAST_FINALIZED_BLOCK_NUMBER,
  logTriggerConfig,
  ok,
  prepareReportRequest,
  Runner,
  TxStatus,
} from "@chainlink/cre-sdk";
import type { EVMLog, TeeRuntime } from "@chainlink/cre-sdk";
import { encodeCallMsg } from "@chainlink/cre-sdk";
import {
  bytesToHex,
  decodeFunctionResult,
  encodeFunctionData,
  toEventSelector,
  zeroAddress,
} from "viem";
import { configWithChainCheck, type Config, type ConfigInput } from "./config";
import { jobIdFromTopic } from "./encoding";
import { runEvaluation, type EvalPort } from "./port";

/** Minimal `getJob` ABI — the AssuranceJob tuple field order is load-bearing
 *  (mirrors packages/contracts/src/AssuranceHub.sol AssuranceJob). */
const GETJOB_ABI = [
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        name: "job",
        components: [
          { name: "client", type: "address" },
          { name: "provider", type: "address" },
          { name: "taskFee", type: "uint256" },
          { name: "guaranteeAmount", type: "uint256" },
          { name: "serviceFee", type: "uint256" },
          { name: "publicCriteriaHash", type: "bytes32" },
          { name: "privateCriteriaCommitment", type: "bytes32" },
          { name: "submissionCommitment", type: "bytes32" },
          { name: "claimEvidenceCommitment", type: "bytes32" },
          { name: "submissionDeadline", type: "uint64" },
          { name: "coverageDuration", type: "uint64" },
          { name: "coverageEnd", type: "uint64" },
          { name: "claimResolutionDeadline", type: "uint64" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
] as const;

/** keccak256 of the ClaimOpened event signature (topics[0]). */
const CLAIM_OPENED_TOPIC0 = toEventSelector(
  "event ClaimOpened(uint256 indexed jobId, address indexed client, bytes32 evidenceCommitment)",
);

/**
 * Build the SDK-backed `EvalPort` for one evaluation. `donRt` routes calls
 * outside the enclave; `rt` provides secrets + `reportFromDon`.
 */
function makePort(rt: TeeRuntime<Config>, evmClient: EVMClient): EvalPort {
  const cfg = rt.config;
  const donRt = rt.usingTheDons();
  return {
    async getSecret(id) {
      try {
        return rt.getSecret({ id }).result().value;
      } catch {
        return undefined;
      }
    },
    async confidentialFetch(req) {
      const res = new ConfidentialHTTPClient()
        .sendRequest(donRt, {
          request: {
            url: req.url,
            method: "GET",
            multiHeaders: { Authorization: { values: ["Bearer {{.token}}"] } },
          },
          vaultDonSecrets: [{ key: "token", owner: cfg.owner }],
        })
        .result();
      if (!ok(res)) {
        return { ok: false };
      }
      return { ok: true, body: json(res) };
    },
    async getJob(jobId) {
      // Honor the `JobView | null` port contract: any RPC failure / revert /
      // malformed reply returns null so the pure core emits REFUSE("READ_FAILED")
      // (a graceful, observable refuse) rather than throwing an unhandled
      // rejection. Mirrors the getSecret adapter above. (todo 047)
      try {
        const reply = evmClient
          .callContract(donRt, {
            call: encodeCallMsg({
              from: zeroAddress,
              to: cfg.assuranceHubAddress,
              data: encodeFunctionData({
                abi: GETJOB_ABI,
                functionName: "getJob",
                args: [jobId],
              }),
            }),
            blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
          })
          .result();
        const job = decodeFunctionResult({
          abi: GETJOB_ABI,
          functionName: "getJob",
          data: bytesToHex(reply.data),
        });
        return {
          status: job.status,
          guaranteeAmount: job.guaranteeAmount,
          submissionCommitment: job.submissionCommitment,
        };
      } catch {
        return null;
      }
    },
    async emitReport(payload) {
      // prepareReportRequest base64-encodes internally — pass HEX, not base64.
      const report = rt.reportFromDon(prepareReportRequest(payload)).result();
      const w = evmClient
        .writeReport(donRt, {
          receiver: cfg.assuranceHubAddress,
          report,
          gasConfig: { gasLimit: cfg.gasLimit },
        })
        .result();
      if (w.txStatus !== TxStatus.SUCCESS) {
        return { ok: false };
      }
      // A real broadcast returns a txHash; a dry-run (`cre workflow simulate` without --broadcast)
      // returns SUCCESS with NO txHash. Accept both — never fabricate a zero hash. Downstream treats
      // an empty txHash as "dry-run, not delivered".
      return { ok: true, txHash: w.txHash ? bytesToHex(w.txHash) : undefined };
    },
    now() {
      return BigInt(Math.floor(rt.now().getTime() / 1000));
    },
  };
}

/** The confidential handler body. Returns a non-secret status string. */
async function evalInTee(
  rt: TeeRuntime<Config>,
  log: EVMLog,
  evmClient: EVMClient,
): Promise<string> {
  const topic1 = log.topics[1];
  if (topic1 === undefined) {
    return "REFUSED:NO_JOBID";
  }
  const jobId = jobIdFromTopic(topic1);

  const port = makePort(rt, evmClient);
  const result = await runEvaluation(port, rt.config, jobId);
  if (result.action === "REPORTED") {
    return `REPORTED:${result.verdict.kind}`;
  }
  const reason =
    result.verdict.kind === "REFUSE" ? result.verdict.reason : "UNKNOWN";
  return `REFUSED:${reason}`;
}

/** Register the workflow handlers against the resolved config. */
function initWorkflow(cfg: Config) {
  const net = getNetwork({
    chainFamily: "evm",
    chainSelectorName: cfg.chainSelectorName,
  });
  if (!net) {
    throw new Error(`unknown chainSelectorName: ${cfg.chainSelectorName}`);
  }
  const selector = net.chainSelector.selector;
  const evmClient = new EVMClient(selector);

  return [
    handlerInTee<EVMLog, EVMLog, Config, string>(
      evmClient.logTrigger(
        logTriggerConfig({
          addresses: [cfg.assuranceHubAddress],
          topics: [[CLAIM_OPENED_TOPIC0]],
          confidence: "FINALIZED",
        }),
      ),
      (rt: TeeRuntime<Config>, log: EVMLog) =>
        evalInTee(rt, log, evmClient),
      [{ tee: "nitro", regions: ["us-west-2"] }],
    ),
  ];
}

export async function main(): Promise<void> {
  const runner = await Runner.newRunner<Config, ConfigInput>({
    configSchema: configWithChainCheck,
  });
  await runner.run(initWorkflow);
}

main();
