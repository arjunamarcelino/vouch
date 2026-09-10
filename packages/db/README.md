# @vouch/db

Prisma 7 client for Vouch's **offchain operational data only**.

## Responsibilities
- Provide a typed Prisma client (generated into the source tree) over PostgreSQL.
- Model operational-only tables: `JobMetadata` (UI title/description, opaque `repoRef`, cached
  status mirror), `NotificationState`, `AgentRunLog`.
- Store amounts as raw **6-decimal base units** (`BigInt`); mirror fields written one-directionally
  by the chain/subgraph poller with `lastSyncedBlock`/`lastSyncedAt` for observable staleness.

## Non-responsibilities
- **Never** the source of truth for money or reputation — that is Arc + The Graph. Mirror fields
  are rebuildable and never load-bearing for money/reputation/authorization decisions.
- **Never** stores private tests, evaluation criteria, repository credentials, or any secret
  material. Write-time validation rejects credential-shaped strings.
- Does not talk to the chain, run the agent, or execute the confidential workflow.
- Holds no real secrets (`DATABASE_URL` via env template only); generated client is git-ignored.
