# Source

- **Real.** Every flaky-tracking issue title currently carrying one of the
  four `flaky/*` tracking labels (`flaky/confirmed`, `flaky/observing`,
  `flaky/suspected`, `flaky/needs-decision`) in `growilabs/growi`, open or
  closed, fetched with:

  ```bash
  for lbl in "flaky/confirmed" "flaky/observing" "flaky/suspected" "flaky/needs-decision"; do
    gh api "repos/growilabs/growi/issues" --paginate -X GET \
      -f state=all -f labels="$lbl" -f per_page=100 -q '.[].title'
  done | sort -u
  ```

- 65 distinct titles (38 `vitest:`, 27 `playwright:`), all of the shape
  `flaky: {IDENTITY_KEY}` `detect-flaky-ci` writes. `identity.parse` must
  classify all 65 as `shape: 'precise'` — none of the real titles happens to
  be a `playwright:{BROWSER}` job-level fallback or a malformed `vitest:` key
  (see `constructed-titles.json` for those two shapes, which have no real
  example currently open or closed in this repo).
- Includes the three titles task 3.3 specifically calls for:
  - **#11752** — the shared setup-hook key, `vitest:test/setup/migrate-mongo.ts:beforeAll migration setup hook timeout (20000ms) during ci-app-test-integration`
    — `{SPEC_PATH}` is the setup file itself, not a spec file.
  - **#11903-style title containing `:`** — several Playwright titles embed a
    colon inside the test title itself, e.g. the `inline-comment.spec.ts`
    entries ("Inline comment - visual refresh: mockup cross-check captures
    > ..."); parsing must not split on the first/last `:` naively.
  - **#11818** — the `.js`-in-title case,
    `vitest:packages/logger/src/logger-factory.spec.ts:unhandled exception - Cannot find module dev/bunyan-format.js (thread-stream worker)`
    — the test title itself names a `.js` file, which must not be mistaken
    for the spec path boundary (the shortest match, ending in `.spec.ts`,
    wins).
  - One further real-data quirk found while collecting this corpus, not
    named in tasks.md but worth pinning: `flaky:
    playwright:playwright/20-basic-features/comments.spec.ts:Successfully
    add comments` has **no browser segment at all** (predates, or otherwise
    never carried, the per-browser identity key) — `identity.parse` must
    still classify it as `shape: 'precise'` with `browser: null`, not treat
    the absent browser as a parse failure.
- **Captured**: 2026-09-16.
