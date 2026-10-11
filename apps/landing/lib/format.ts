import { formatUnits, parseUnits } from "viem";
import { USDC_DECIMALS, arcTestnet } from "@vouch/shared/chains";
import { HEX32_RE, HEX_ADDRESS_RE } from "@vouch/shared/schemas";

/**
 * USDC money helpers. USDC is 6-decimal on the ERC-20 interface (NOT the 18-dec native-gas accounting —
 * the Arc dual-decimal footgun). Amounts on the wire are base-unit decimal STRINGS; never a JS number.
 * A branded type stops a raw bigint (block number, bps) being formatted as money by accident, and all
 * money arithmetic goes through `addUsdc`/`gteUsdc` so the validation + brand aren't bypassed (P3/M3).
 */
export type UsdcAmount = bigint & { readonly __brand: "UsdcAmount" };

const BASE_UNITS_RE = /^\d+$/u;

/** Parse a base-unit string (from the API) into a branded amount. Throws on a non-integer string. */
export function toUsdc(baseUnitStr: string): UsdcAmount {
  if (!BASE_UNITS_RE.test(baseUnitStr)) throw new Error(`invalid USDC base units: ${baseUnitStr}`);
  return BigInt(baseUnitStr) as UsdcAmount;
}

/** Sum base-unit strings through the brand (validates both operands). */
export function addUsdc(a: string, b: string): UsdcAmount {
  return (toUsdc(a) + toUsdc(b)) as UsdcAmount;
}

/** `a >= b` over validated base-unit strings (e.g. allowance >= required). */
export function gteUsdc(a: string, b: string): boolean {
  return toUsdc(a) >= toUsdc(b);
}

/** Shared hex validators (reuse the single source of truth in `@vouch/shared`). */
export const isHash32 = (v: string): boolean => HEX32_RE.test(v);
export const isAddress = (v: string): boolean => HEX_ADDRESS_RE.test(v);

/** Display a base-unit string as USDC (6-dec), grouped, with a trailing "USDC". Display-only edge. */
export function formatUsdc(baseUnitStr: string, opts?: { symbol?: boolean }): string {
  const n = formatUnits(toUsdc(baseUnitStr), USDC_DECIMALS);
  // group the integer part; keep the fractional part as-is (viem trims trailing zeros)
  const [intPart, frac] = n.split(".");
  const grouped = (intPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const body = frac ? `${grouped}.${frac}` : grouped;
  return opts?.symbol === false ? body : `${body} USDC`;
}

/** Parse user input (e.g. "20.5") to a 6-dec base-unit string for the wire. Rejects >6 fractionals. */
export function parseUsdcInput(input: string): string {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/u.test(trimmed)) {
    throw new Error("Enter a positive USDC amount (no sign or exponent)");
  }
  const frac = trimmed.split(".")[1];
  if (frac && frac.length > USDC_DECIMALS) {
    throw new Error(`USDC supports at most ${USDC_DECIMALS} decimal places`);
  }
  return parseUnits(trimmed, USDC_DECIMALS).toString();
}

const EXPLORER = arcTestnet.blockExplorers.default.url.replace(/\/$/u, "");
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

/**
 * Provenance-gated explorer links (security P1.8). A tx link renders ONLY when the hash was actually
 * confirmed on-chain (an observed receipt / a chain-sourced read) — never for simulated or
 * hash-shaped seed data. Returns null otherwise so the caller renders plain text, never a fabricated
 * link. Address links refuse the zero/undeployed address.
 */
export function explorerTxLink(hash: string | null | undefined, confirmedOnChain: boolean): string | null {
  if (!confirmedOnChain || !hash || !isHash32(hash)) return null;
  return `${EXPLORER}/tx/${hash}`;
}

export function explorerAddressLink(address: string | null | undefined): string | null {
  if (!address || !isAddress(address) || address.toLowerCase() === ZERO_ADDR) return null;
  return `${EXPLORER}/address/${address}`;
}

/** Short 0x…abcd form for addresses/hashes in dense tables. */
export function shortHex(value: string, lead = 6, tail = 4): string {
  return value.length > lead + tail + 2 ? `${value.slice(0, lead)}…${value.slice(-tail)}` : value;
}
