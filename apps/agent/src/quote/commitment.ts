import {
  keccak256,
  toHex,
  verifyTypedData,
  type Address,
  type Hex,
  type LocalAccount,
  type TypedDataDomain,
} from "viem";
import {
  quoteCommitmentSchema,
  parseOrThrow,
  type JobRequest,
  type RiskScore,
  type QuoteCommitment,
} from "@vouch/shared/schemas";
import type { VerifyReasonCode } from "@vouch/shared/reasonCodes";
import { jobHash as computeJobHash } from "./canonicalize";

/**
 * Signed, expiring quote commitment (plan §5). EIP-712 typed data (verifiable on-EVM, ecosystem
 * standard). Signed by a dedicated quote-signer key kept separate from the Circle payment wallet.
 *
 * `nonce == quoteId` — one canonical replay/escrow key (security M2). `jobHash` binds the exact job
 * terms. `verifyQuote` is PURE (no nonce consumption — that happens at action time in the executor,
 * §0.3): it reports expiry, tampering, bad-signer, and chain-mismatch as returned reason codes, never
 * throws.
 *
 * uint fields cross the wire as strings (JSON can't serialize bigint); `toTypedMessage` converts them
 * to viem `bigint` for signing/verifying (TS review §3).
 */

export const EIP712_DOMAIN_NAME = "VouchAssuranceQuote";
export const EIP712_DOMAIN_VERSION = "1";

/** The signed struct — binds the computed amounts + commitment fields (jobHash covers payer/payee). */
export const QUOTE_TYPES = {
  Quote: [
    { name: "quoteId", type: "bytes32" },
    { name: "jobHash", type: "bytes32" },
    { name: "provider", type: "address" },
    { name: "token", type: "address" },
    { name: "recommendedGuaranteeLimit", type: "uint256" },
    { name: "assuranceServiceFee", type: "uint256" },
    { name: "minProviderCollateral", type: "uint256" },
    { name: "premiumBps", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "validAfter", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export interface CommitmentConfig {
  chainId: number;
  /** Stable, non-zero even in the custody fallback (§0.3 M1). */
  verifyingContract: Address;
  quoteTtlSeconds: bigint;
}

interface QuoteMessage {
  quoteId: Hex;
  jobHash: Hex;
  provider: Address;
  token: Address;
  recommendedGuaranteeLimit: bigint;
  assuranceServiceFee: bigint;
  minProviderCollateral: bigint;
  premiumBps: bigint;
  nonce: Hex;
  validAfter: bigint;
  expiresAt: bigint;
}

function domain(cfg: CommitmentConfig): TypedDataDomain {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId: cfg.chainId,
    verifyingContract: cfg.verifyingContract,
  };
}

/** Convert the string-typed score/commitment fields into a viem typed-data message (bigint uints). */
function toTypedMessage(
  score: RiskScore,
  token: Address,
  quoteId: Hex,
  jobHash: Hex,
  validAfter: bigint,
  expiresAt: bigint,
): QuoteMessage {
  return {
    quoteId,
    jobHash,
    provider: score.provider as Address,
    token,
    recommendedGuaranteeLimit: BigInt(score.recommendedGuaranteeLimit),
    assuranceServiceFee: BigInt(score.assuranceServiceFee),
    minProviderCollateral: BigInt(score.minProviderCollateral),
    premiumBps: BigInt(score.premiumBps),
    nonce: quoteId, // nonce == quoteId
    validAfter,
    expiresAt,
  };
}

/** Deterministic-ish unique quoteId (== nonce): binds jobHash + amounts + validity + a random salt. */
function deriveQuoteId(jobHash: Hex, score: RiskScore, validAfter: bigint, salt: string): Hex {
  return keccak256(
    toHex(
      `${jobHash}:${score.recommendedGuaranteeLimit}:${score.assuranceServiceFee}:${validAfter.toString()}:${salt}`,
    ),
  );
}

export interface BuildQuoteArgs {
  score: RiskScore;
  job: JobRequest;
  account: LocalAccount;
  cfg: CommitmentConfig;
  nowSeconds: bigint;
  /** Unique per quote (e.g. crypto.randomUUID()) so identical requests get distinct quoteIds. */
  salt: string;
}

/** Build + sign a quote commitment. `account` is the dedicated quote signer (never the payment wallet). */
export async function buildQuoteCommitment(args: BuildQuoteArgs): Promise<QuoteCommitment> {
  const { score, job, account, cfg, nowSeconds, salt } = args;
  const jHash = computeJobHash(job);
  const validAfter = nowSeconds;
  const expiresAt = nowSeconds + cfg.quoteTtlSeconds;
  const quoteId = deriveQuoteId(jHash, score, validAfter, salt);
  const message = toTypedMessage(
    score,
    job.token as Address,
    quoteId,
    jHash,
    validAfter,
    expiresAt,
  );

  const signature = await account.signTypedData({
    domain: domain(cfg),
    types: QUOTE_TYPES,
    primaryType: "Quote",
    message,
  });

  return parseOrThrow(
    quoteCommitmentSchema,
    {
      quoteId,
      jobHash: jHash,
      nonce: quoteId,
      score,
      validAfter: validAfter.toString(),
      expiresAt: expiresAt.toString(),
      signature,
    },
    "quote commitment",
  );
}

export interface VerifyArgs {
  commitment: QuoteCommitment;
  job: JobRequest;
  expectedSigner: Address;
  cfg: CommitmentConfig;
  nowSeconds: bigint;
}

/** PURE verification (plan §5). Returns reason codes; never throws, never consumes the nonce. */
export async function verifyQuote(
  args: VerifyArgs,
): Promise<{ valid: boolean; reasonCodes: VerifyReasonCode[] }> {
  const { commitment, job, expectedSigner, cfg, nowSeconds } = args;
  const reasonCodes: VerifyReasonCode[] = [];

  const validAfter = BigInt(commitment.validAfter);
  const expiresAt = BigInt(commitment.expiresAt);
  if (nowSeconds < validAfter) reasonCodes.push("QUOTE_NOT_YET_VALID");
  if (nowSeconds >= expiresAt) reasonCodes.push("QUOTE_EXPIRED");

  // Altered job parameters: recompute the opaque jobHash and compare.
  if (computeJobHash(job) !== commitment.jobHash) reasonCodes.push("JOB_PARAMS_ALTERED");

  // Signature: recover over the SAME typed data. A mismatched domain (chainId/verifyingContract)
  // recovers a different signer, so chain-mismatch surfaces as BAD_SIGNER unless we check explicitly.
  const message = toTypedMessage(
    commitment.score,
    job.token as Address,
    commitment.quoteId as Hex,
    commitment.jobHash as Hex,
    validAfter,
    expiresAt,
  );
  const sigOk = await verifyTypedData({
    address: expectedSigner,
    domain: domain(cfg),
    types: QUOTE_TYPES,
    primaryType: "Quote",
    message,
    signature: commitment.signature as Hex,
  });
  if (!sigOk) reasonCodes.push("BAD_SIGNER");

  return { valid: reasonCodes.length === 0, reasonCodes };
}
