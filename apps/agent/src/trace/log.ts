import { keccak256, toHex } from "viem";

/**
 * Hash-chained decision-trace records (plan §9.1). Each record commits to its predecessor via
 * `prevRecordHash`, so the per-quote chain is tamper-evident: recomputing any record's hash and
 * walking the links detects a dropped or altered entry. `scoreInputs` (allowlisted strings only —
 * never raw request/config blobs, security M5) lets an auditor recompute the deterministic score.
 *
 * Linearization is DB-enforced (UNIQUE(quoteId, prevRecordHash) + UNIQUE(quoteId, seq) in
 * quotesRepo) so concurrent writers can't fork the chain; this module is the PURE hashing side.
 */

/** The genesis predecessor for the first record in a quote's chain. */
export const GENESIS_HASH = `0x${"0".repeat(64)}` as const;

export type TraceOutcome = "QUOTED" | "BOND_POSTED" | "BOND_REFUNDED" | "REJECTED";

export interface TraceBody {
  quoteId: string;
  seq: number;
  correlationId: string;
  outcome: TraceOutcome;
  reasonCodes: string[];
  scoreInputs: Record<string, string>;
  txHash: string | null;
  prevRecordHash: string;
}

/**
 * Deterministically canonicalize a trace body (sorted keys, stable encoding) so the same body always
 * hashes to the same value across processes. `prevRecordHash` is INCLUDED in the payload so
 * link-tampering is detected; `recordHash` is the output and therefore excluded.
 */
export function canonicalizeTrace(body: TraceBody): string {
  return JSON.stringify({
    correlationId: body.correlationId,
    outcome: body.outcome,
    prevRecordHash: body.prevRecordHash,
    quoteId: body.quoteId,
    reasonCodes: [...body.reasonCodes].sort(),
    scoreInputs: sortRecord(body.scoreInputs),
    seq: body.seq,
    txHash: body.txHash,
  });
}

export function recordHash(body: TraceBody): `0x${string}` {
  return keccak256(toHex(canonicalizeTrace(body)));
}

/** Build the next record in a chain from the previous tip's hash (GENESIS_HASH if first). */
export function nextRecord(
  prevRecordHash: string,
  prevSeq: number | null,
  fields: Omit<TraceBody, "seq" | "prevRecordHash">,
): TraceBody & { recordHash: `0x${string}` } {
  const body: TraceBody = {
    ...fields,
    seq: (prevSeq ?? -1) + 1,
    prevRecordHash,
  };
  return { ...body, recordHash: recordHash(body) };
}

function sortRecord(r: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(r).sort()) out[k] = r[k]!;
  return out;
}
