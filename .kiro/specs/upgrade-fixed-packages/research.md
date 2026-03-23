# Research & Design Decisions

---
**Purpose**: Capture discovery findings for the pinned package audit and upgrade initiative.
**Usage**: Inform design.md decisions; provide evidence for future maintainers.
---

## Summary
- **Feature**: `upgrade-fixed-packages`
- **Discovery Scope**: Extension (auditing existing dependency constraints)
- **Key Findings**:
  - Bootstrap bug (#39798) fixed in v5.3.4 — safe to upgrade to latest 5.3.x
  - next-themes original issue (#122) was resolved long ago; upgrade to v0.4.x feasible but has Next.js 16 `cacheComponents` caveat
  - Node.js ^24 enables stable `require(esm)`, unlocking ESM-only package upgrades for server code
  - `escape-string-regexp` can be replaced entirely by native `RegExp.escape()` (ES2026, Node.js 24)
  - handsontable license situation unchanged — must remain pinned at 6.2.2
  - @aws-sdk pinning comment is misleading; packages can be freely upgraded

## Research Log

### Bootstrap v5.3.3 Bug (#39798)
- **Context**: bootstrap pinned at `=5.3.2` due to modal header regression in v5.3.3
- **Sources Consulted**: https://github.com/twbs/bootstrap/issues/39798, https://github.com/twbs/bootstrap/pull/41336
- **Findings**:
  - Issue CLOSED on 2025-04-03
  - Fixed in v5.3.4 via PR #41336 (Fix modal and offcanvas header collapse)
  - Bug: `.modal-header` lost `justify-content: space-between`, causing content collapse
  - Latest stable: v5.3.8 (August 2025)
- **Implications**: Safe to upgrade from `=5.3.2` to `^5.3.4`. Skip v5.3.3 entirely. Recommend `^5.3.4` or pin to latest `=5.3.8`.

### next-themes Type Error (#122)
- **Context**: next-themes pinned at `^0.2.1` due to reported type error in v0.3.0
- **Sources Consulted**: https://github.com/pacocoursey/next-themes/issues/122, https://github.com/pacocoursey/next-themes/issues/375
- **Findings**:
  - Issue #122 CLOSED on 2022-06-02 — was specific to an old beta version (v0.0.13-beta.3), not v0.3.0
  - The pinning reason was based on incomplete information; v0.2.0+ already had the fix
  - Latest: v0.4.6 (March 2025). Peers: `react ^16.8 || ^17 || ^18 || ^19`
  - **Caveat**: Issue #375 reports a bug with Next.js 16's `cacheComponents` feature — stale theme values when cached components reactivate
  - PR #377 in progress to fix via `useSyncExternalStore`
  - Without `cacheComponents`, v0.4.6 works fine with Next.js 16
- **Implications**: Upgrade to v0.4.x is feasible. GROWI uses Pages Router (not App Router), so `cacheComponents` is likely not relevant. Breaking API changes between v0.2 → v0.4 need review. Used in 12 files across apps/app.

### ESM-only Package Compatibility (escape-string-regexp, string-width, @keycloak)
- **Context**: Three packages pinned to CJS-compatible versions because newer versions are ESM-only
- **Sources Consulted**: Node.js v22.12.0 release notes (require(esm) enabled by default), TC39 RegExp.escape Stage 4, sindresorhus ESM guidance, npm package pages
- **Findings**:

  **escape-string-regexp** (^4.0.0):
  - Used in 6 server-side files + 3 shared package files (all server context)
  - Node.js 24 has stable `require(esm)` — ESM-only v5 would work
  - **Better**: `RegExp.escape()` is ES2026 Stage 4, natively available in Node.js 24 (V8 support)
  - Can eliminate the dependency entirely

  **string-width** (=4.2.2):
  - Used only in `packages/editor/src/models/markdown-table.js`
  - `@growi/editor` has `"type": "module"` and builds with Vite (ESM context)
  - No server-side value imports (only type imports in `sync-ydoc.ts`, erased at compile)
  - Safe to upgrade to v7.x

  **@keycloak/keycloak-admin-client** (^18.0.0):
  - Used in 1 server-side file: `features/external-user-group/server/service/keycloak-user-group-sync.ts`
  - Latest: v26.5.5 (February 2026)
  - `require(esm)` in Node.js 24 should handle it, but API has significant breaking changes (v18 → v26)
  - Sub-path exports need verification
  - Higher risk upgrade — API surface changes expected

- **Implications**: string-width is the easiest upgrade. escape-string-regexp should be replaced by native `RegExp.escape()`. @keycloak requires careful API migration and is higher risk.

### @aws-sdk Pinning Analysis
- **Context**: @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner pinned at 3.454.0
- **Sources Consulted**: mongodb package.json, npm registry, GROWI source code
- **Findings**:
  - Pinning comment says "required by mongodb@4.16.0" but is misleading
  - mongodb@4.17.2 has `@aws-sdk/credential-providers: ^3.186.0` as **optional** dependency — a different package
  - The S3 client packages are used directly by GROWI for file upload (server/service/file-uploader/aws/)
  - Latest: @aws-sdk/client-s3@3.1014.0 (March 2026) — over 500 versions behind
  - AWS SDK v3 follows semver; any 3.x should be compatible
- **Implications**: Remove the misleading comment. Change from exact `3.454.0` to `^3.454.0` or update to latest. Low risk.

### Handsontable License Status
- **Context**: handsontable pinned at =6.2.2 (last MIT version), @handsontable/react at =2.1.0
- **Sources Consulted**: handsontable.com/docs/software-license, npm, Hacker News discussion
- **Findings**:
  - v7.0.0+ (March 2019) switched from MIT to proprietary license — unchanged as of 2026
  - Free "Hobby" license exists but restricted to non-commercial personal use
  - Commercial use requires paid subscription
  - MIT alternatives: AG Grid Community (most mature), Jspreadsheet CE, Univer (Apache 2.0)
- **Implications**: Must remain pinned. No action possible without license purchase or library replacement. Library replacement is out of scope for this spec.

## Design Decisions

### Decision: Replace escape-string-regexp with native RegExp.escape()
- **Context**: escape-string-regexp v5 is ESM-only; used in 9 files across server code
- **Alternatives Considered**:
  1. Upgrade to v5 with require(esm) support — works but adds unnecessary dependency
  2. Replace with native `RegExp.escape()` — zero dependencies, future-proof
- **Selected Approach**: Replace with `RegExp.escape()`
- **Rationale**: Node.js 24 supports `RegExp.escape()` natively (ES2026 Stage 4). Eliminates a dependency entirely.
- **Trade-offs**: Requires touching 9 files, but changes are mechanical (find-and-replace)
- **Follow-up**: Verify `RegExp.escape()` is available in the project's Node.js 24 target

### Decision: Upgrade string-width directly to v7.x
- **Context**: Used only in @growi/editor (ESM package, Vite-bundled, client-only)
- **Selected Approach**: Direct upgrade to latest v7.x
- **Rationale**: Consumer is already ESM; zero CJS concern
- **Trade-offs**: None significant; API is stable

### Decision: Upgrade bootstrap to ^5.3.4
- **Context**: Bug fixed in v5.3.4; latest is 5.3.8
- **Selected Approach**: Change from `=5.3.2` to `^5.3.4`
- **Rationale**: Original bug resolved; skip v5.3.3
- **Trade-offs**: Need to verify GROWI's custom SCSS and modal usage against 5.3.4+ changes

### Decision: Upgrade next-themes to latest 0.4.x
- **Context**: Original issue was a misunderstanding; latest is v0.4.6
- **Selected Approach**: Upgrade to `^0.4.4` (or latest)
- **Rationale**: Issue #122 was specific to old beta, not v0.3.0. GROWI uses Pages Router, so cacheComponents bug is not relevant.
- **Trade-offs**: Breaking API changes between v0.2 → v0.4 need review. 12 files import from next-themes.
- **Follow-up**: Review v0.3.0 and v0.4.0 changelogs for breaking changes

### Decision: Relax @aws-sdk version to caret range
- **Context**: Pinning was based on misleading comment; packages are independent of mongodb constraint
- **Selected Approach**: Change from `3.454.0` to `^3.454.0`
- **Rationale**: AWS SDK v3 follows semver; the comment conflated credential-providers with S3 client
- **Trade-offs**: Low risk. Conservative approach keeps minimum at 3.454.0.

### Decision: Defer @keycloak upgrade (high risk)
- **Context**: v18 → v26 has significant API breaking changes; only 1 file affected
- **Selected Approach**: Document as upgradeable but defer to a separate task
- **Rationale**: API migration requires Keycloak server compatibility testing; out of proportion for a batch upgrade task
- **Trade-offs**: Remains on old version longer, but isolated to one feature

### Decision: Keep handsontable pinned (license constraint)
- **Context**: v7+ is proprietary; no free alternative that's drop-in
- **Selected Approach**: No change. Document for future reference.
- **Rationale**: License constraint is permanent unless library is replaced entirely
- **Trade-offs**: None — this is a business/legal decision, not technical

## Risks & Mitigations
- **Bootstrap SCSS breakage**: v5.3.4+ may have SCSS variable changes → Run `pre:styles-commons` and `pre:styles-components` builds to verify
- **next-themes API changes**: v0.2 → v0.4 has breaking changes → Review changelog; test all 12 consuming files
- **RegExp.escape() availability**: Ensure Node.js 24 V8 includes it → Verify with simple runtime test
- **@aws-sdk transitive dependency changes**: Newer AWS SDK may pull different transitive deps → Monitor bundle size
- **Build regression**: Any upgrade could break Turbopack build → Follow incremental upgrade strategy with build verification per package

## Future Considerations (Out of Scope)

### transpilePackages cleanup in next.config.ts
- **Context**: `next.config.ts` defines `getTranspilePackages()` listing 60+ ESM-only packages to force Turbopack to bundle them instead of externalising. The original comment says: "listing ESM packages until experimental.esmExternals works correctly to avoid ERR_REQUIRE_ESM".
- **Relationship to require(esm)**: `transpilePackages` and `require(esm)` solve different problems. `transpilePackages` prevents Turbopack from externalising packages during SSR; `require(esm)` allows Node.js to load ESM packages via `require()` at runtime. With Node.js 24's stable `require(esm)`, externalised ESM packages *should* load correctly in SSR, meaning some `transpilePackages` entries may become unnecessary.
- **Why not now**: (1) Turbopack's `esmExternals` handling is still `experimental`; (2) removing entries shifts packages from bundled to externalised, which means they appear in `.next/node_modules/` and must be classified as `dependencies` per the `package-dependencies` rule; (3) 60+ packages need individual verification. This is a separate investigation with a large blast radius.
- **Recommendation**: Track as a separate task. Test by removing a few low-risk entries (e.g., `bail`, `ccount`, `zwitch`) and checking whether SSR still works with Turbopack externalisation + Node.js 24 `require(esm)`.

## References
- [Bootstrap issue #39798](https://github.com/twbs/bootstrap/issues/39798) — modal header regression, fixed in v5.3.4
- [next-themes issue #122](https://github.com/pacocoursey/next-themes/issues/122) — type error, resolved in v0.2.0
- [next-themes issue #375](https://github.com/pacocoursey/next-themes/issues/375) — Next.js 16 cacheComponents bug
- [TC39 RegExp.escape() Stage 4](https://socket.dev/blog/tc39-advances-3-proposals-to-stage-4-regexp-escaping-float16array-and-redeclarable-global-eval) — ES2026
- [Node.js require(esm) stability](https://joyeecheung.github.io/blog/2025/12/30/require-esm-in-node-js-from-experiment-to-stability/) — stable since Node.js 22.12.0
- [Handsontable license change](https://handsontable.com/docs/javascript-data-grid/software-license/) — proprietary since v7.0.0
