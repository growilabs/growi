# Implementation Plan

> Salvage source: PR #10443. Branch from `master` (NOT the current
> `imprv/x-access-token-header` branch, which carries unrelated MongoDB-regex work).
> Test-first per repo TDD policy.

- [x] 1. Foundation: shared token-source extraction utility
- [x] 1.1 Create the shared token-source extractor with unit tests (test-first)
  - Write failing unit tests first, covering: precedence Bearer > `X-GROWI-ACCESS-TOKEN` header > query > body; non-string / array-valued header is ignored; header key resolves case-insensitively
  - Define the canonical header-name constant and implement the pure extractor that returns the resolved token string or null
  - Observable: a new unit test file passes, exercising every precedence, guard, and casing case; the no-header case resolves exactly to the prior Bearer/query/body result
  - _Requirements: 1.3, 3.1, 3.2, 3.3, 3.4_
  - _Boundary: extractAccessToken_

- [x] 2. Core: parser integration with header support
- [x] 2.1 (P) Route the scoped access-token parser through the shared extractor
  - Replace the inline token chain and type guard with the shared extractor; leave scope check, read-only rejection, and user serialization unchanged
  - Add an integration test: a valid scoped token supplied in the `X-GROWI-ACCESS-TOKEN` header with a satisfying scope authenticates the token owner
  - Observable: the access-token integration suite passes including the new header test, and the existing invalid-token / insufficient-scope / read-only tests remain green
  - _Requirements: 1.1, 1.2, 4.1, 4.2, 4.3_
  - _Boundary: parserForAccessToken_
  - _Depends: 1.1_
- [x] 2.2 (P) Route the legacy api-token parser through the shared extractor
  - Replace the inline token chain and type guard with the shared extractor
  - Add an integration test: a valid legacy api-token supplied in the `X-GROWI-ACCESS-TOKEN` header authenticates the owner; confirm the `acceptLegacy` gating is unchanged (legacy token ignored when the route does not opt in)
  - Observable: the api-token integration suite passes including the new header test
  - _Requirements: 2.1, 2.2, 4.1_
  - _Boundary: parserForApiToken_
  - _Depends: 1.1_

- [x] 3. Integration: OpenAPI advertisement of the header method
- [x] 3.1 (P) Declare the `accessTokenHeaderAuth` security scheme in the apiv1 and apiv3 definitions
  - Add an `apiKey` / `in: header` / `name: x-growi-access-token` scheme to the security schemes and to the top-level security array in both definition files
  - Independent of tasks 2.1/2.2 (separate boundary, no shared files), so it may run concurrently with the parser work
  - Observable: both definition files contain the new scheme while retaining the existing `bearer` and `accessTokenInQuery` schemes
  - _Requirements: 5.1, 5.3_
  - _Boundary: OpenAPI definitions_
- [x] 3.2 Apply the header auth method to every advertising route
  - Add an `accessTokenHeaderAuth` entry after every `accessTokenInQuery` block across the 9 current-master route files (26 sites): activity, user-activities, bookmark-folder, import, in-app-notification, page-listing, g2g-transfer, app-settings index, and features/ai-tools/suggest-path. Do not apply PR #10443's route hunks verbatim — drive edits off a full-tree sweep (`grep -rn accessTokenInQuery apps/app/src`) to absorb the `app-settings` path drift, the missing `user-activities`, and the `features/` suggest-path route
  - Observable: the number of added `accessTokenHeaderAuth` lines equals 26, and every route that advertises `accessTokenInQuery` also advertises `accessTokenHeaderAuth`
  - _Requirements: 5.2_
  - _Boundary: apiv3 route security blocks_
  - _Depends: 3.1_

- [x] 4. Validation: regression and spec verification
- [x] 4.1 Verify OpenAPI regeneration and run end-to-end quality gates
  - Regenerate the apiv1/apiv3 specs and confirm `accessTokenHeaderAuth` appears in the schemes and on each route that previously advertised `accessTokenInQuery`
  - Run lint, the full access-token-parser test suite, and the build for the app package
  - Confirm non-regression: requests with no `X-GROWI-ACCESS-TOKEN` header resolve identically to pre-change behavior
  - Observable: lint/typecheck/tests green and regenerated specs consistent (0 query-ops missing the header method; added-line count check = 26). NOTE: the full app build is blocked by a pre-existing, unrelated devcontainer dependency-hoisting issue (`@lezer/*`, `styled-jsx` in the client bundle) — see Implementation Notes; verify the production build in CI.
  - _Requirements: 3.3, 5.1, 5.2, 5.3_
  - _Depends: 2.1, 2.2, 3.2_

## Implementation Notes
- Req 3.4 semantics: a non-string `X-GROWI-ACCESS-TOKEN` value (duplicated header → array) is coerced to `undefined` before the `??` chain so resolution falls through to query/body, per requirements.md 3.4. design.md was corrected to match (the initial "centralized guard at end" wording implied short-circuit-to-null).
- OpenAPI route coverage: enumerate `accessTokenInQuery` with a FULL-tree sweep (`grep -rn accessTokenInQuery apps/app/src`), not just `server/routes/apiv3` — the `features/` tree holds the suggest-path route (26 sites / 9 files, not 25 / 8).
- Task 4.1 build gate: `turbo run build --filter @growi/app` FAILS in this devcontainer on a PRE-EXISTING, unrelated client-bundle dependency-hoisting issue — Turbopack cannot resolve `@lezer/common`, `@lezer/lr` (transitive deps of `@codemirror/lang-python`/`lang-yaml`) and `styled-jsx` (import trace: ConflictDiffModal → editor → codemirror; none touched by this server-only change). `pnpm install --frozen-lockfile` reports "Already up to date", so the state is lockfile-defined and independent of this feature. Verified green for this change: 23/23 access-token-parser tests, `lint:typecheck` (exit 0), `lint:openapi:apiv1`+`apiv3` (1 passing/0 failing, 0 query-ops missing the header method), biome on changed files (only the pre-existing `res`-unused warning). The production build should be confirmed in CI (`reusable-app-prod.yml`), where the dependency environment is correct.
