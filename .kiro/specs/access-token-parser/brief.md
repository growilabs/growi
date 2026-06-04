# Brief: access-token-parser

## Problem

GROWI's API authentication currently accepts an access token in only two ways: as a
Bearer token in the `Authorization` header, or as an `access_token` query parameter
(see https://docs.growi.org/en/api/rest-v3.html).

When the `Authorization` header is already consumed by something else (e.g. Basic
authentication on a reverse proxy), callers are forced to fall back to the query
parameter. Putting the token in a GET query string is insecure — it leaks into URLs,
server logs, browser history, and referrers
(see https://owasp.org/www-community/vulnerabilities/Information_exposure_through_query_strings_in_url).

There is also no spec governing the `access-token-parser` middleware, so future changes
have no requirements/design baseline to maintain against (cc-sdd).

## Current State

- The `access-token-parser` middleware is **already implemented** at
  `apps/app/src/server/middlewares/access-token-parser/`:
  - `index.ts` — `accessTokenParser(scopes, opts)` orchestrator; runs
    `parserForAccessToken(scopes)` and, when `opts.acceptLegacy`, `parserForApiToken`.
  - `access-token.ts` — `parserForAccessToken`: scope-checked AccessToken model lookup.
  - `api-token.ts` — `parserForApiToken`: legacy `User.apiToken` lookup.
  - `extract-bearer-token.ts` — pulls the Bearer token from `Authorization`.
  - Co-located `*.integ.ts` integration tests.
- Token extraction order today (both parsers):
  `bearerToken ?? req.query.access_token ?? req.body.access_token`.
  **There is no header source between Bearer and query.**
- An **open upstream PR (#10443, branch `support/api-token-header`, base `master`,
  +114/-6, 13 files)** by ryu-sato adds exactly the missing `X-GROWI-ACCESS-TOKEN`
  header support. This PR is the salvage source for the current deliverable.
- **No `access-token-parser` spec exists yet.**

## Desired Outcome

- API callers can authenticate by sending the token in the `x-growi-access-token`
  request header, with priority directly after the `Authorization` Bearer token and
  before the query/body sources — for both the scoped AccessToken path and the legacy
  api-token path.
- The header auth method is advertised in the OpenAPI definitions (apiv1 + apiv3) as a
  new `accessTokenHeaderAuth` security scheme and applied to the relevant routes.
- A spec (this one) exists so all future `access-token-parser` changes can be maintained
  via cc-sdd (requirements → design → tasks → impl).

## Approach

Salvage PR #10443 onto a fresh branch cut from `master` (NOT from the current
`imprv/x-access-token-header` branch, which carries unrelated MongoDB-regex work), then
open a new PR to `master`. The technical change is small and well understood:

1. Insert `?? req.headers['x-growi-access-token']` between the Bearer token and the
   query/body sources in both `access-token.ts` and `api-token.ts`.
2. Add the `accessTokenHeaderAuth` (`type: apiKey`, `in: header`,
   `name: x-growi-access-token`) security scheme to `bin/openapi/definition-apiv1.js`
   and `definition-apiv3.js`, and to the top-level `security` array.
3. Add `- accessTokenHeaderAuth: []` to the per-route OpenAPI `security` blocks.
4. Add integration tests covering the header path for both parsers.

**Salvage hygiene**: copy only the *meaningful* changes. PR #10443 also contains
incidental `import` reordering (the `SCOPE` import moved) caused by its older base —
do not carry that noise. Re-verify the route list against current `master`, since routes
added/changed since the PR was opened may also need the `accessTokenHeaderAuth: []` line
for consistency.

**Workflow: hybrid.** Lock intent in brief + requirements first; implement the salvage
and open the PR; then finalize design/tasks so the spec stands as the maintenance
baseline that matches what shipped.

## Scope

- **In**:
  - `x-growi-access-token` header as a token source in `parserForAccessToken` and
    `parserForApiToken`, with correct priority ordering.
  - `accessTokenHeaderAuth` OpenAPI security scheme (apiv1 + apiv3) and its application
    to the affected routes.
  - Integration tests for the header path.
  - A spec baseline (requirements/design/tasks) for the access-token-parser middleware,
    centered on the header feature with minimal surrounding context.
- **Out**:
  - Redesigning the scope model, the AccessToken model, or the legacy api-token mechanism.
  - Client/SDK or docs-site changes beyond the in-repo OpenAPI definitions.
  - Deprecating or removing the existing query/body token sources.
  - Broad brownfield documentation of the entire middleware (kept minimal by decision).

## Boundary Candidates

- Token-source extraction & priority ordering (the parser logic).
- OpenAPI security-scheme declaration and per-route application.
- Test coverage for the new header path.

## Out of Boundary

- Authentication/authorization scope semantics (owned by the AccessToken model + SCOPE
  definitions in `@growi/core`).
- Reverse-proxy / Basic-auth configuration (the motivating environment, not this code).

## Upstream / Downstream

- **Upstream**: `@growi/core` interfaces (`Scope`, `AccessTokenParser*`, `IUserHasId`),
  the `AccessToken` Mongoose model, `serializeUserSecurely`. Salvage source: PR #10443.
- **Downstream**: every apiv3 route guarded by `accessTokenParser`; OpenAPI consumers
  reading the generated security schemes.

## Existing Spec Touchpoints

- **Extends**: none (new spec).
- **Adjacent**: none of the existing specs (auto-scroll, editor-keymaps, oauth2-email-support,
  suggest-path, …) overlap this middleware.

## Constraints

- Branch from `master`, not the current `imprv/x-access-token-header` branch.
- TDD per repo policy: header-path integration tests precede/accompany the logic change.
- All in-repo code comments and spec documents in English (`spec.json.language: en`).
- Header name is matched case-insensitively by Express via `req.headers['x-growi-access-token']`.
- Final PR targets `master`; use `gh` CLI for all GitHub operations.
