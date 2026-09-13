import Link from "next/link";
import { Card, CardContent } from "@vouch/ui/components/card";

/**
 * Shared job-list fallbacks (review 113) so Overview and Jobs render loading / error / empty identically
 * instead of copy-pasting the same three branches.
 */
export function JobsLoading() {
  return <p className="text-sm text-muted-foreground">Loading your jobs…</p>;
}

export function JobsError() {
  return (
    <Card>
      <CardContent className="p-6 text-sm text-warning">Couldn&apos;t load your jobs right now.</CardContent>
    </Card>
  );
}

export function JobsEmpty() {
  return (
    <Card>
      <CardContent className="p-10 text-center text-sm text-muted-foreground">
        No jobs yet.{" "}
        <Link href="/app/jobs/new" className="font-medium text-primary hover:underline">
          Create one
        </Link>{" "}
        to attach a post-completion guarantee.
      </CardContent>
    </Card>
  );
}
