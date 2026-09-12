import { ClaimFlow } from "../../../../components/claims/ClaimFlow";

/** Claim route. Next 16 async params → client claim flow (wallet + CRE progress polling). */
export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClaimFlow id={id} />;
}
