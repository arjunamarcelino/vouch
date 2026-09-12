"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldX, Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@vouch/ui/components/card";
import { Badge } from "@vouch/ui/components/badge";
import { buttonVariants } from "@vouch/ui/components/button";
import { cn } from "@vouch/ui/lib/utils";
import { USDC_ADDRESS } from "@vouch/shared/chains";
import { computeCommitment, computePublicCriteriaHash, randomSalt } from "@vouch/shared/commitment";
import type { QuoteCommitment } from "@vouch/shared/schemas";
import { useAuthMe, useTopProviders } from "../../../lib/api/hooks";
import { useTxEngine } from "../../../lib/tx/engine";
import { prepareOpenJob, prepareApprove, requestQuote, fetchAllowance } from "../../../lib/api/prepare";
import { parseUsdcInput, formatUsdc, shortHex, isAddress, addUsdc, gteUsdc } from "../../../lib/format";
import { TxStatus } from "../../../components/tx/TxStatus";

/**
 * Create job (WS-3). Collects provider, fees, deadlines, coverage, the public acceptance criteria
 * (hashed on-chain), and the PRIVATE criteria — which are hashed to a bytes32 commitment CLIENT-SIDE
 * (shared helper); only the commitment is submitted, the raw text + salt never leave the browser. A
 * best-effort risk-quote preview degrades to "unavailable" when the agent isn't configured. Funding is
 * a separate approval stage then openJob, driven by the shared tx-engine.
 */
const COVERAGE_OPTIONS = [
  { label: "24 hours", seconds: 86_400 },
  { label: "48 hours", seconds: 172_800 },
  { label: "72 hours", seconds: 259_200 },
  { label: "7 days", seconds: 604_800 },
];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-subtle-foreground">{hint}</span> : null}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function CreateJobPage() {
  const router = useRouter();
  const me = useAuthMe();
  const providers = useTopProviders();
  const engine = useTxEngine();

  const [provider, setProvider] = useState("");
  const [taskFee, setTaskFee] = useState("20");
  const [guarantee, setGuarantee] = useState("100");
  const [serviceFee, setServiceFee] = useState("0");
  const [deadline, setDeadline] = useState("");
  const [coverage, setCoverage] = useState(COVERAGE_OPTIONS[0]!.seconds);
  const [publicCriteria, setPublicCriteria] = useState("");
  const [privateCriteria, setPrivateCriteria] = useState("");
  const [uiTitle, setUiTitle] = useState("");
  const [quote, setQuote] = useState<QuoteCommitment | null>(null);
  const [quoteState, setQuoteState] = useState<"idle" | "loading" | "error">("idle");
  const [formError, setFormError] = useState<string | null>(null);

  const addrOk = isAddress(provider);
  const deadlineSec = deadline ? Math.floor(new Date(deadline).getTime() / 1000) : 0;
  const canSubmit =
    !!me.data && addrOk && Number(taskFee) > 0 && Number(guarantee) > 0 && deadlineSec > Math.floor(Date.now() / 1000) && !engine.isBusy;

  const buildBody = useMemo(
    () => () => {
      const salt = randomSalt();
      const privateCriteriaCommitment = computeCommitment(privateCriteria, salt);
      // Persist the salt locally so the private criteria can be reproduced/revealed at claim time.
      // Guarded: a private-mode/quota throw must not break job submission (security P3).
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(`vouch:criteria-salt:${privateCriteriaCommitment}`, salt);
        } catch {
          /* storage unavailable — the commitment still submits; reveal simply won't autofill */
        }
      }
      return {
        provider,
        taskFee: parseUsdcInput(taskFee),
        guaranteeAmount: parseUsdcInput(guarantee),
        serviceFee: parseUsdcInput(serviceFee || "0"),
        submissionDeadline: String(deadlineSec),
        coverageDuration: String(coverage),
        publicCriteriaHash: computePublicCriteriaHash(publicCriteria),
        privateCriteriaCommitment,
        uiTitle,
      };
    },
    [provider, taskFee, guarantee, serviceFee, deadlineSec, coverage, publicCriteria, privateCriteria, uiTitle],
  );

  async function previewQuote() {
    if (!me.data || !addrOk) return;
    setQuoteState("loading");
    setQuote(null);
    try {
      const q = await requestQuote(crypto.randomUUID(), {
        provider,
        payer: me.data.address,
        payee: provider,
        token: USDC_ADDRESS,
        taskFee: parseUsdcInput(taskFee),
        requestedGuarantee: parseUsdcInput(guarantee),
        providerCollateral: parseUsdcInput(guarantee),
        coverageDurationSeconds: String(coverage),
        taskCategory: "CODE_FIX",
        verificationMethod: "PRIVATE_REGRESSION",
      });
      setQuote(q);
      setQuoteState("idle");
    } catch {
      // Agent not configured / stale subgraph → fail-closed, no fabricated quote.
      setQuoteState("error");
    }
  }

  function submit() {
    setFormError(null);
    let body: ReturnType<typeof buildBody>;
    try {
      body = buildBody();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Invalid input");
      return;
    }
    const escrow = addUsdc(body.taskFee, body.serviceFee).toString();
    void engine.run({
      action: "OPEN_JOB",
      prepare: (k) => prepareOpenJob(k, body),
      approval: {
        isNeeded: async () => !gteUsdc((await fetchAllowance()).allowance, escrow),
        prepare: (k) => prepareApprove(k, { amount: escrow }),
      },
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Create a job</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Attach a provider-funded, capped guarantee to AI-agent work. Private criteria are hashed in your
        browser — only the commitment is stored.
      </p>

      {!me.data ? (
        <Card className="mt-6">
          <CardContent className="p-6 text-sm text-muted-foreground">Connect your wallet and sign in to create a job.</CardContent>
        </Card>
      ) : null}

      {engine.flow.stage !== "idle" ? (
        <div className="mt-4">
          <TxStatus flow={engine.flow} onReset={engine.reset} />
        </div>
      ) : null}
      {engine.flow.stage === "done" ? (
        <div className="mt-3">
          <button onClick={() => router.push("/dashboard")} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Go to dashboard
          </button>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Provider &amp; task</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Provider address" hint={providers.data?.length ? "Pick an indexed provider or paste an address" : "Paste the provider's address"}>
              <input className={cn(inputCls, "font-mono text-xs")} placeholder="0x…" value={provider} onChange={(e) => setProvider(e.target.value)} />
              {providers.data?.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {providers.data.slice(0, 5).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setProvider(p.id)}
                      className="rounded-full border border-border px-2 py-0.5 font-mono text-xs hover:bg-muted"
                    >
                      {shortHex(p.id)}
                    </button>
                  ))}
                </div>
              ) : null}
            </Field>
            <Field label="Title"><input className={inputCls} value={uiTitle} onChange={(e) => setUiTitle(e.target.value)} placeholder="Fix the auth bug" /></Field>
            <Field label="Public acceptance criteria" hint="Hashed on-chain (public).">
              <textarea className={cn(inputCls, "min-h-20")} value={publicCriteria} onChange={(e) => setPublicCriteria(e.target.value)} />
            </Field>
            <Field label="Private criteria (confidential)" hint="Hashed to a commitment in your browser; the raw text never leaves this device.">
              <textarea className={cn(inputCls, "min-h-20")} value={privateCriteria} onChange={(e) => setPrivateCriteria(e.target.value)} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Terms</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Task fee (USDC)"><input className={inputCls} inputMode="decimal" value={taskFee} onChange={(e) => setTaskFee(e.target.value)} /></Field>
            <Field label="Requested guarantee (USDC)"><input className={inputCls} inputMode="decimal" value={guarantee} onChange={(e) => setGuarantee(e.target.value)} /></Field>
            <Field label="Service fee (USDC)"><input className={inputCls} inputMode="decimal" value={serviceFee} onChange={(e) => setServiceFee(e.target.value)} /></Field>
            <Field label="Coverage duration">
              <select className={inputCls} value={coverage} onChange={(e) => setCoverage(Number(e.target.value))}>
                {COVERAGE_OPTIONS.map((o) => (
                  <option key={o.seconds} value={o.seconds}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Submission deadline"><input type="datetime-local" className={inputCls} value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
          </CardContent>
        </Card>

        {/* Risk quote preview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="size-4 text-primary" aria-hidden /> Risk quote preview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <button type="button" onClick={previewQuote} disabled={!addrOk || quoteState === "loading"} className={cn(buttonVariants({ variant: "outline", size: "sm" }), (!addrOk || quoteState === "loading") && "opacity-50 pointer-events-none")}>
              {quoteState === "loading" ? "Requesting…" : "Preview quote"}
            </button>
            {quoteState === "error" ? (
              <p className="text-muted-foreground">Risk quote unavailable (the agent isn&apos;t configured or the subgraph is stale). You can still set a guarantee manually.</p>
            ) : quote ? (
              <div className="space-y-1">
                <p>Premium: <span className="font-medium tabular-nums">{quote.score.premiumBps} bps</span></p>
                <p>Recommended guarantee limit: <span className="font-medium tabular-nums">{formatUsdc(quote.score.recommendedGuaranteeLimit)}</span></p>
                <p>Min provider collateral: <span className="font-medium tabular-nums">{formatUsdc(quote.score.minProviderCollateral)}</span></p>
                <div className="flex flex-wrap gap-1 pt-1">
                  {quote.score.reasonCodes.map((c) => (
                    <Badge key={c} variant="default">{c}</Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Covered / not covered */}
        <Card>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
            <div>
              <p className="flex items-center gap-1 text-sm font-medium text-success"><ShieldCheck className="size-4" aria-hidden /> Covered</p>
              <p className="mt-1 text-sm text-muted-foreground">A private regression proving a covered failure within the coverage window, verified confidentially.</p>
            </div>
            <div>
              <p className="flex items-center gap-1 text-sm font-medium text-muted-foreground"><ShieldX className="size-4" aria-hidden /> Not covered</p>
              <p className="mt-1 text-sm text-muted-foreground">Failures outside the window, issues outside the agreed criteria, or disputes after coverage ends.</p>
            </div>
          </CardContent>
        </Card>

        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
        <div className="flex items-center gap-3">
          <button onClick={submit} disabled={!canSubmit} className={cn(buttonVariants({ size: "lg" }), !canSubmit && "opacity-50 pointer-events-none")}>
            Approve &amp; create job
          </button>
          {me.data ? <Badge variant="success">live</Badge> : <Badge variant="warning">connect to act</Badge>}
        </div>
      </div>
    </div>
  );
}
