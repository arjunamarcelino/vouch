/**
 * Integer-exact BigInt helpers for USDC (6-dec base units) and basis-point math.
 *
 * Vouch does ALL money/ratio math in BigInt (ADR-006; docs/solutions BigInt learning): 6-dec USDC
 * counters routinely exceed 2^53, so `Number()`, `Math.*`, `toFixed`, and float division are banned.
 * `Math.min/max` coerce to number — use these instead. Every caller multiplies BEFORE dividing.
 */

export const BPS_DENOMINATOR = 10_000n;

export function bigIntMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function bigIntMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/** Clamp `x` into `[lo, hi]`. Requires `lo <= hi`. */
export function clamp(x: bigint, lo: bigint, hi: bigint): bigint {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

/**
 * `value * bps / 10000`, rounding DOWN (BigInt division truncates toward zero). Multiply-first, so no
 * precision is lost. Use for amounts where truncation favours the payer (e.g. a charged premium band).
 */
export function applyBpsFloor(value: bigint, bps: bigint): bigint {
  return (value * bps) / BPS_DENOMINATOR;
}

/**
 * `value * bps / 10000`, rounding UP. Use where under-shooting is unsafe — a collateral floor or a
 * fee that must never round to zero — so truncation can't under-collateralize by up to 1 base unit.
 */
export function applyBpsCeil(value: bigint, bps: bigint): bigint {
  const numerator = value * bps;
  if (numerator === 0n) return 0n;
  return (numerator + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}
