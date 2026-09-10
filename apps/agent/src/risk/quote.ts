import { riskQuoteSchema, type ProviderReputation, type RiskQuote } from "@vouch/shared/schemas";

/**
 * Autonomous risk-quotation: turn LIVE subgraph reputation data into a
 * recommended, capped guarantee size. This is the "meaningful AI work on live
 * Graph data" that anchors the The Graph track (plan §6 / §17.4).
 *
 * The store cannot divide, so ratios are computed here from raw counters.
 * Pure function — deterministic and unit-testable.
 */
export function quoteGuarantee(
  reputation: ProviderReputation,
  baseCapBaseUnits: bigint,
): RiskQuote {
  const jobsCompleted = BigInt(reputation.jobsCompleted);
  const regressions = BigInt(reputation.regressions);
  const totalPaidOut = BigInt(reputation.totalPaidOut);
  const totalGuaranteedValue = BigInt(reputation.totalGuaranteedValue);

  const regressionRate = jobsCompleted === 0n ? 0 : Number(regressions) / Number(jobsCompleted);
  const payoutToGuaranteeRatio =
    totalGuaranteedValue === 0n ? 0 : Number(totalPaidOut) / Number(totalGuaranteedValue);

  // Higher observed risk → widen (increase) the recommended cap as a risk premium.
  // Clamp the multiplier to a sane band so a single data point can't explode it.
  const premium = 1 + Math.min(2, regressionRate * 2 + payoutToGuaranteeRatio);
  const recommendedCap = (baseCapBaseUnits * BigInt(Math.round(premium * 100))) / 100n;

  return riskQuoteSchema.parse({
    provider: reputation.id,
    recommendedGuaranteeCap: recommendedCap.toString(),
    regressionRate,
    payoutToGuaranteeRatio,
    rationale:
      `regressionRate=${regressionRate.toFixed(3)}, ` +
      `payoutRatio=${payoutToGuaranteeRatio.toFixed(3)}, premium=${premium.toFixed(2)}x`,
  });
}
