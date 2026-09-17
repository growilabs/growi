# Expected values — `parse-identity-key` (task 3.3)

What applying `investigate-flaky-test/SKILL.md` Step 1's **current** regex
and 4-step procedure (as of commit `31d0a55f7f`, before this task) gives for
every title in `../identity/flaky-issue-titles.json`, plus the two
constructed titles in `../identity/constructed-titles.json`.

**How this "before" value was produced**, same situation as `lockfile-
overlap.md`: Step 1's regex is prose an LLM applies by reading, not an
existing executable pipeline, so there is no shell one-liner to capture
stdout from. The "before" value here is the documented regex
(`^([^:]+:)?(.+?\.(tsx?|jsx?)):(.*)$`, applied to everything after the
`kind:` prefix) and the surrounding 4-step description, translated
literally into the small reference script used to produce
`parse-identity-key-titles.json` — not a rewrite or an improvement of it.
`lib/identity.ts` (this task's implementation) was checked against that same
reference output, one title at a time, in `lib/identity.spec.ts`.

## The 65 real titles

`../identity/flaky-issue-titles.json` — every title currently carrying a
`flaky/*` tracking label, fetched 2026-09-16 (see that file's `.meta.md` for
the exact `gh api` command). All 65 parse as `shape: "precise"`; the full
per-title expectation is `parse-identity-key-titles.json` in this directory
(one row per title: `{ title, parsed: { shape, kind, browser, specPath,
testTitle } }`).

Three named cases (task 3.3):

| Issue | Title (verbatim) | kind | browser | specPath | testTitle |
|---|---|---|---|---|---|
| #11752 | `flaky: vitest:test/setup/migrate-mongo.ts:beforeAll migration setup hook timeout (20000ms) during ci-app-test-integration` | `vitest` | `null` | `test/setup/migrate-mongo.ts` | `beforeAll migration setup hook timeout (20000ms) during ci-app-test-integration` |
| a `:`-containing Playwright title (`inline-comment.spec.ts`) | `flaky: playwright:chromium:playwright/20-basic-features/inline-comment.spec.ts:Inline comment - visual refresh: mockup cross-check captures > Capture popover states 5 (normal) and 6 (edit mode) in DARK mode (Req 4.4)` | `playwright` | `chromium` | `playwright/20-basic-features/inline-comment.spec.ts` | `Inline comment - visual refresh: mockup cross-check captures > Capture popover states 5 (normal) and 6 (edit mode) in DARK mode (Req 4.4)` |
| #11818 | `flaky: vitest:packages/logger/src/logger-factory.spec.ts:unhandled exception - Cannot find module dev/bunyan-format.js (thread-stream worker)` | `vitest` | `null` | `packages/logger/src/logger-factory.spec.ts` | `unhandled exception - Cannot find module dev/bunyan-format.js (thread-stream worker)` |

One further real-data quirk this corpus surfaced, not named in tasks.md but
pinned in the tests anyway: a title with **no browser segment at all**
(`flaky: playwright:playwright/20-basic-features/comments.spec.ts:Successfully
add comments`) still parses as `precise`, with `browser: null` — the
optional browser group in the current regex has always allowed this; it is
not a new relaxation this task introduces.

## The two constructed titles

`../identity/constructed-titles.json` — no real example of either shape
currently exists in `growilabs/growi` (search recorded in that file's
`.meta.md`):

| Title | shape | kind | browser | specPath | testTitle |
|---|---|---|---|---|---|
| `flaky: playwright:chromium` | `playwright-job-level` | `playwright` | `chromium` | `null` | `null` |
| `flaky: vitest:no-extension-anywhere-in-this-title` | `malformed` | `vitest` | `null` | `null` | `null` |

## What stays a procedure judgment, not moved into the script

Per research.md §"14 候補の現在位置" (candidate #8): the parse above is
mechanical; what `investigate-flaky-test/SKILL.md` Step 1 does with each of
the three shapes is not:

- `precise` — proceed to Step 2 reproduction using `specPath` / `testTitle`
  directly.
- `playwright-job-level` — do not guess a spec path; read the linked run's
  full Playwright report first (the run URL in the issue's "First
  observation" section) to find the actual flaky spec before attempting
  Step 2. If the report is no longer available, report LOW confidence at
  Step 4 rather than guessing.
- `malformed` — stop and report it as a precondition failure rather than
  guessing a path (no `detect-flaky-ci` path produces a malformed `vitest:`
  key, so seeing one at all is itself the signal something upstream is
  wrong).
