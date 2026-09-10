import { Button } from "@vouch/ui/components/button";
import { Card, CardHeader, CardTitle, CardContent } from "@vouch/ui/components/card";
import { Badge } from "@vouch/ui/components/badge";

const steps = [
  "Client pays the provider 20 USDC to fix an auth bug.",
  "Provider locks 100 USDC as guarantee collateral.",
  "Public tests pass — the 20 USDC task fee is released.",
  "For 24h, a private regression test runs confidentially.",
  "If a covered regression is proven, the client receives the 100 USDC.",
  "The result becomes part of the provider's onchain performance history.",
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Vouch</h1>
        <Badge variant="success">outcome assurance</Badge>
      </div>
      <p className="mt-2 text-sm opacity-80">
        Confidential post-completion outcome assurance for AI-agent work. Not a marketplace, not
        insurance, not plain escrow.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>How a guarantee resolves</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="mt-6 flex gap-3">
        <Button>View jobs</Button>
        <Button variant="outline">Provider reputation</Button>
      </div>

      <p className="mt-8 text-xs opacity-60">
        Sponsor integrations (Arc, The Graph, Chainlink CRE) are scaffolded placeholders — this shell
        renders explicit &quot;not configured&quot; states rather than fabricated data.
      </p>
    </main>
  );
}
