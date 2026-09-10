# @vouch/config

Shared build/tooling configuration consumed by every app and package.

## Responsibilities
- Provide strict base `tsconfig` presets (`tsconfig/base.json`, `nextjs.json`, `node.json`) with
  `strict` and `noUncheckedIndexedAccess`.
- Provide the shared ESLint v9 flat config (`eslint/index.js`: js.recommended + typescript-eslint
  recommendedTypeChecked + prettier).
- Provide the shared Prettier config.
- Exported via subpaths so consumers re-export/extend them.

## Non-responsibilities
- Ships no runtime/application code and no business logic.
- Holds no secrets, schemas, or data.
- Does not set consumer-specific settings that must live in the consumer (e.g. ESLint
  `tsconfigRootDir`, or the `verbatimModuleSyntax`-off overrides required only by `@vouch/api`).
