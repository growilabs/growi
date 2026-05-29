# Gap Analysis: access-token-parser (X-GROWI-ACCESS-TOKEN header)

_Date: 2026-05-29 · Salvage source: PR #10443 (`support/api-token-header` → `master`)_

## 1. Current State

The middleware already exists at
`apps/app/src/server/middlewares/access-token-parser/`:

| File | Role | Token extraction today |
|------|------|------------------------|
| `index.ts` | `accessTokenParser(scopes, opts)` orchestrator; runs `parserForAccessToken`, then `parserForApiToken` when `opts.acceptLegacy` | — |
| `access-token.ts` | scope-checked `AccessToken` lookup | `bearer ?? query ?? body` |
| `api-token.ts` | legacy `User.apiToken` lookup | `bearer ?? query ?? body` |
| `extract-bearer-token.ts` | pulls Bearer from `Authorization` | (unchanged by this work) |
| `*.integ.ts` | co-located integration tests | — |

- `AccessTokenParserReq` (`packages/core/src/interfaces/server/access-token-parser.ts`)
  extends Express `Request`, so `req.headers['x-growi-access-token']` is typed as
  `string | string[] | undefined` — the existing `typeof accessToken !== 'string'` guard
  already covers the array case.
- **Header-name convention exists**: g2g-transfer declares
  `export const X_GROWI_TRANSFER_KEY_HEADER_NAME = 'x-growi-transfer-key'`
  (`apps/app/src/server/service/g2g-transfer.ts:40`) and references it in the OpenAPI
  definition. This is the precedent for a shared header-name constant.
- No reference to `x-growi-access-token` exists anywhere yet.
- OpenAPI security schemes (`bearer`, `accessTokenInQuery`) are declared in
  `apps/app/bin/openapi/definition-apiv1.js` and `definition-apiv3.js`.

## 2. Requirement-to-Asset Map

| Requirement | Existing asset | Gap | Tag |
|-------------|----------------|-----|-----|
| R1 header on scoped path | `access-token.ts` token resolution | insert header source between Bearer and query | Missing |
| R2 header on legacy path | `api-token.ts` token resolution | insert header source between Bearer and query | Missing |
| R3 priority / non-regression | both parsers' `??` chain | order header after Bearer, before query/body; array guard already present | Missing (partial reuse) |
| R4 invalid/insufficient handling | `AccessToken.findUserIdByToken`, scope check, `readOnly` check | none — validation is source-agnostic; reused as-is | Reuse |
| R5 OpenAPI advertisement | apiv1/apiv3 definitions + per-route `security` blocks | add `accessTokenHeaderAuth` scheme + add `- accessTokenHeaderAuth: []` to every route block | Missing |

## 3. Salvage Drift vs current master (CRITICAL)

PR #10443 was authored on an older tree. The route-file portion has drifted; **do not
apply the patch verbatim**:

- **`app-settings.js` → `app-settings/index.ts`**: the PR edits `apps/app/src/server/routes/apiv3/app-settings.js`,
  but master has refactored it to `app-settings/index.ts` (3 `accessTokenInQuery` blocks).
  The PR hunk will not apply.
- **`user-activities.ts` missed**: master's `user-activities.ts` (1 block) carries
  `accessTokenInQuery` but is **not** in PR #10443. Verbatim salvage would leave it
  inconsistent.
- The PR also carries incidental `import` reordering noise (the `SCOPE` import moved) from
  its older base — exclude it.

**Authoritative route set in current master** — 8 files, 25 `accessTokenInQuery` blocks,
each needs an `accessTokenHeaderAuth: []` sibling:

| File | blocks |
|------|--------|
| `activity.ts` | 1 |
| `user-activities.ts` | 1 |
| `bookmark-folder.ts` | 6 |
| `import.ts` | 4 |
| `in-app-notification.ts` | 4 |
| `page-listing.ts` | 4 |
| `g2g-transfer.ts` | 2 |
| `app-settings/index.ts` | 3 |

**Robust salvage method**: instead of applying the PR patch, add
`- accessTokenHeaderAuth: []` immediately after **every** `- accessTokenInQuery: []`
occurrence in current master. This is drift-proof and self-verifying (count of added
lines must equal 25). Carry the logic + test changes from the PR (they apply cleanly),
discard its route-file hunks.

## 4. Implementation Approach Options

### Option A — Verbatim PR salvage (apply #10443 patch)
- ✅ Fastest mechanically.
- ❌ Breaks on `app-settings` path drift; ❌ misses `user-activities.ts`; ❌ imports noise.
- **Rejected** — produces an inconsistent, non-applying result.

### Option B — Extend in place, drift-corrected (recommended)
- Logic: add `?? req.headers['x-growi-access-token']` between Bearer and query in both
  `access-token.ts` and `api-token.ts`.
- OpenAPI: declare `accessTokenHeaderAuth` in both definition files; add
  `- accessTokenHeaderAuth: []` after every `accessTokenInQuery` block across the 8
  current-master route files (25 sites).
- Tests: port the two header-path integration tests from the PR.
- ✅ Drift-proof, consistent, minimal new surface; reuses all validation.
- ❌ Manual care across 25 sites (mitigated by the "after every accessTokenInQuery" rule).

### Option C — Extract a shared header-name constant + Option B
- In addition to Option B, define `X_GROWI_ACCESS_TOKEN_HEADER_NAME = 'x-growi-access-token'`
  (mirroring `X_GROWI_TRANSFER_KEY_HEADER_NAME`) and reference it from both parsers and the
  OpenAPI `name` fields, removing the magic string.
- ✅ Single source of truth, aligns with coding-style (no magic strings) and the existing
  g2g convention; reduces drift risk for future changes.
- ❌ Slightly larger diff than the raw PR; OpenAPI `.js` files use literal strings today, so
  the constant may only be cleanly shared on the parser side unless the definition files
  import it. **Decision for design phase**: whether to thread the constant into the
  OpenAPI definitions or keep the literal there.

## 5. Effort & Risk

- **Effort: S (1–3 days)** — established pattern, one-line logic change ×2, mechanical
  OpenAPI edits ×25, two integration tests.
- **Risk: Low** — validation/authorization reused unchanged; header is purely additive and
  guarded; existing sources untouched (R3 non-regression). Main risk is **coverage
  completeness** of the 25 OpenAPI sites, mitigated by the count check.

## 6. Recommendations for Design Phase

- **Preferred approach**: Option B, with Option C's constant as a recommended refinement.
- **Key decisions to settle in design**:
  1. Whether to introduce `X_GROWI_ACCESS_TOKEN_HEADER_NAME` and whether the OpenAPI
     definition `.js` files reference it or keep the literal.
  2. Confirm the priority order `Bearer ?? header ?? query ?? body` for both parsers.
  3. Confirm the OpenAPI route set = the 8 current-master files (not the PR's 7), explicitly
     including `user-activities.ts` and `app-settings/index.ts`.
- **Research items**: none outstanding — the change is well understood and self-contained.
- **Branch reminder**: cut from `master`, not the current `imprv/x-access-token-header`
  branch (which carries unrelated MongoDB-regex work).

---

## Design Synthesis Outcomes (design phase)

**Generalization** — R1 (scoped path) and R2 (legacy path) are the same problem: read the
token from one more source at the same precedence position. Both parsers duplicate the
`bearer ?? query ?? body` chain + `typeof` guard. Decision: extract a pure
`extractAccessToken(req): string | null` helper (new `extract-access-token.ts`) owning the
precedence `Bearer ?? header ?? query ?? body`. This makes precedence the single source of
truth (directly serves R3's cross-parser consistency) and removes the drift seam. Aligns
with coding-style "Pure Function Extraction" and the recorded feedback on single source of
truth / drift prevention.

**Build vs Adopt** — Header name: adopt the existing `X_GROWI_TRANSFER_KEY_HEADER_NAME`
precedent (g2g-transfer.ts) → define `X_GROWI_ACCESS_TOKEN_HEADER_NAME = 'x-growi-access-token'`
in the parser TS module. Express natively lowercases header keys → case-insensitive (R1.3),
no library needed. OpenAPI `.js` definitions keep the literal string (CommonJS build
scripts), mirroring how g2g keeps the literal in OpenAPI while the constant lives in TS.

**Simplification** — No config/feature-flag for the header (out of requirements). Do not
modify `extract-bearer-token.ts`. Centralize the `typeof !== 'string'` guard inside
`extractAccessToken` so both parsers collapse to
`const accessToken = extractAccessToken(req); if (accessToken == null) return;`. Parser
signatures and all validation/authorization remain unchanged (reuse → R4, R2.2, R3.3).

**Route-edit method (drift-proof)** — Drive OpenAPI route edits off current-master
`accessTokenInQuery` sites (8 files / 25 blocks), NOT the PR #10443 file list. Add
`- accessTokenHeaderAuth: []` after each. Self-check: added line count == 25.

---

## Coverage Correction (task 3.2 implementation)

The gap-analysis route sweep grepped only `apps/app/src/server/routes` and undercounted.
A full-tree sweep (`grep -rn accessTokenInQuery apps/app/src`) finds **26** sites across
**9** files — the 8 originally listed plus
`apps/app/src/features/ai-tools/suggest-path/server/routes/apiv3/index.ts` (1) in the
`features/` tree. Requirement 5.2 ("every route advertising the query method also
advertises the header method") requires this 9th file, so task 3.2's scope was extended
to 26 sites. Lesson: sweep `apps/app/src` (including `features/`), not just
`server/routes/apiv3`, when enumerating OpenAPI security blocks.
