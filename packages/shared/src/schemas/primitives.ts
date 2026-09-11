import { z } from "zod";

/**
 * Shared Zod regex primitives — the SINGLE source of truth for the hex/base-unit string shapes used
 * across web / api / agent. Extracted so `apps/api`'s new boundary DTOs (TransactionRequest, claim
 * inputs, selectors) reuse the exact same patterns instead of re-hand-rolling `/^0x…{64}$/` and
 * drifting (TS review §3). Imported by `./index` and `./api`; no cycle.
 *
 * Financial fields are decimal STRINGS of 6-decimal USDC base units at the boundary (never JS number
 * — precision); contracts/subgraph use uint256/BigInt.
 */

/** 0x-prefixed 20-byte address. */
export const hexAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/u, "must be a 0x-prefixed 20-byte address");

/** Integer string of USDC base units (6-dec). */
export const baseUnits = z.string().regex(/^\d+$/u, "must be an integer string of USDC base units");

/** Non-negative integer string (counts / block numbers / positive bps like a premium factor). */
export const uintString = z.string().regex(/^\d+$/u, "must be a non-negative integer string");

/**
 * A ratio in basis points: a non-negative integer, or exactly `-1` (the "undefined ratio" sentinel
 * the subgraph emits on a zero denominator). Any OTHER negative is rejected so a spurious value can't
 * be silently read as zero-risk (017).
 */
export const ratioBpsString = z.string().regex(/^(-1|\d+)$/u, "must be a bps integer or the -1 sentinel");

/** bytes32 hex (quoteId / jobHash / nonce / commitment). */
export const hex32 = z.string().regex(/^0x[a-fA-F0-9]{64}$/u, "must be a 0x-prefixed 32-byte hex string");

/** 65-byte ECDSA signature hex (r‖s‖v). */
export const hexSignature = z
  .string()
  .regex(/^0x[a-fA-F0-9]{130}$/u, "must be a 0x-prefixed 65-byte signature");

/** Arbitrary 0x-prefixed calldata (even-length hex). */
export const hexData = z.string().regex(/^0x([a-fA-F0-9]{2})*$/u, "must be 0x-prefixed hex calldata");

/** 4-byte function selector (0x + 8 hex). */
export const selectorHex = z
  .string()
  .regex(/^0x[a-fA-F0-9]{8}$/u, "must be a 0x-prefixed 4-byte function selector");
