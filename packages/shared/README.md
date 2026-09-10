# @vouch/shared

Shared contracts of data: Zod schemas, types, chain constants, ABIs, logger, and error types
consumed across `web`, `api`, `agent`, `cre-workflow`, and `subgraph`.

## Responsibilities
- Zod schemas (Job, Guarantee, Payout, RiskQuote, API DTOs) with types via `z.infer`.
- Chain constants (`arcTestnet` / `arcMainnet` defs, contract addresses) in `constants/chains.ts`.
- ABIs consumed by viem — sourced from the `@vouch/contracts` build (contracts are the single
  source of truth for ABIs).
- Structured pino logger factory with redaction of secret-shaped fields, and explicit
  discriminated-union error types.
- Exposed via subpath exports (`./schemas`, `./chains`, `./abis`, `./logger`, `./errors`).

## Non-responsibilities
- Holds no runtime state, no database, no network services.
- Contains no secrets and no real credentials.
- The node-only logger (pino) must never be imported into the web client bundle.
- Does not own ABIs — it mirrors them from `@vouch/contracts`.
