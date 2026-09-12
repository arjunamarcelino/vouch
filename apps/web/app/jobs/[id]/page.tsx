import { JobDetail } from "../../../components/jobs/JobDetail";

/**
 * Job detail route. Next 16 `params` is async — await it in this Server Component and hand the id to the
 * client detail component (which owns the wallet/poll/mutate surface).
 */
export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JobDetail id={id} />;
}
