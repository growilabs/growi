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

- [ ] 3. Integration: OpenAPI advertisement of the header method
- [x] 3.1 (P) Declare the `accessTokenHeaderAuth` security scheme in the apiv1 and apiv3 definitions
  - Add an `apiKey` / `in: header` / `name: x-growi-access-token` scheme to the security schemes and to the top-level security array in both definition files
  - Independent of tasks 2.1/2.2 (separate boundary, no shared files), so it may run concurrently with the parser work
  - Observable: both definition files contain the new scheme while retaining the existing `bearer` and `accessTokenInQuery` schemes
  - _Requirements: 5.1, 5.3_
  - _Boundary: OpenAPI definitions_
- [ ] 3.2 Apply the header auth method to every advertising route
  - Add an `accessTokenHeaderAuth` entry after every `accessTokenInQuery` block across the 8 current-master route files (25 sites): activity, user-activities, bookmark-folder, import, in-app-notification, page-listing, g2g-transfer, app-settings index. Do not apply PR #10443's route hunks verbatim — drive edits off the current-master `accessTokenInQuery` sites to absorb the `app-settings` path drift and the missing `user-activities`
  - Observable: the number of added `accessTokenHeaderAuth` lines equals 25, and every route that advertises `accessTokenInQuery` also advertises `accessTokenHeaderAuth`
  - _Requirements: 5.2_
  - _Boundary: apiv3 route security blocks_
  - _Depends: 3.1_

- [ ] 4. Validation: regression and spec verification
- [ ] 4.1 Verify OpenAPI regeneration and run end-to-end quality gates
  - Regenerate the apiv1/apiv3 specs and confirm `accessTokenHeaderAuth` appears in the schemes and on each route that previously advertised `accessTokenInQuery`
  - Run lint, the full access-token-parser test suite, and the build for the app package
  - Confirm non-regression: requests with no `X-GROWI-ACCESS-TOKEN` header resolve identically to pre-change behavior
  - Observable: lint, tests, and build are green; the regenerated specs include the new scheme; the added-line count check (25) holds
  - _Requirements: 3.3, 5.1, 5.2, 5.3_
  - _Depends: 2.1, 2.2, 3.2_
