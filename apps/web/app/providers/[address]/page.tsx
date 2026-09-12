import { ProviderProfile } from "../../../components/providers/ProviderProfile";

/** Provider reputation route. Next 16 async params → client profile component (polls/renders Graph data). */
export default async function ProviderProfilePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <ProviderProfile address={address} />;
}
