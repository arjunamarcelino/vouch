import { test } from "node:test";
import assert from "node:assert/strict";
import { Orchestrator } from "./orchestrator";
import type { JobEvent } from "./monitor/watch";

function evt(jobId: bigint, name: JobEvent["name"] = "JobCreated", blockNumber: bigint | null = 100n): JobEvent {
  return { name, jobId, blockNumber };
}

test("start() runs reconciliation", async () => {
  let reconciled = false;
  const o = new Orchestrator({ reconcile: async () => { reconciled = true; }, onJobOpened: async () => {} });
  await o.start();
  assert.equal(reconciled, true);
});

test("acts once per jobId even when JobCreated and JobFunded both fire", async () => {
  const seen: bigint[] = [];
  const o = new Orchestrator({ reconcile: async () => {}, onJobOpened: async (id) => { seen.push(id); } });
  await o.handleJobEvent(evt(7n, "JobCreated"));
  await o.handleJobEvent(evt(7n, "JobFunded"));
  await o.handleJobEvent(evt(8n, "JobCreated"));
  assert.deepEqual(seen, [7n, 8n]);
});

test("finality gate defers action until enough confirmations", async () => {
  const seen: bigint[] = [];
  let head = 100n;
  const o = new Orchestrator({
    reconcile: async () => {},
    onJobOpened: async (id) => { seen.push(id); },
    minConfirmations: 5n,
    chainHead: async () => head,
  });
  await o.handleJobEvent(evt(9n, "JobCreated", 100n)); // head-block = 0 < 5 → deferred
  assert.deepEqual(seen, []);
  head = 106n; // now 6 confirmations
  await o.handleJobEvent(evt(9n, "JobCreated", 100n));
  assert.deepEqual(seen, [9n]);
});
