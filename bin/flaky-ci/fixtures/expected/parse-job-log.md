# Expected values — `parse-job-log` (task 3.1)

What the **current** procedure's own commands
(`.claude/skills/detect-flaky-ci/SKILL.md` Step 2 / Step 2b / Step 3 — task
3.1 does not change that text; `eaebaa7479` is simply the commit these
measurements were taken at) return for each fixture under `../job-logs/`, and
what
`node bin/flaky-ci/scripts/parse-job-log.ts` returns for the same input.
Requirement 1.3 is the comparison: same input, same facts.

The "before" pipeline, run verbatim on each fixture:

```bash
sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' <fixture> \
  | grep -E "FAIL |::error| flaky|[0-9]+ (failed|flaky|passed|skipped)"
```

Run 2026-09-16. Both columns below are measured, not predicted.

## `ci-app-test-100952911197-excerpt.txt` (real, ESC bytes, timestamps)

**Before — 10 matching lines**, of which only 5 are vitest failure blocks:

```
2026-09-04T07:59:07.1665297Z FAIL unused-key count 80 exceeds baseline 10 (Requirement 2)
2026-09-04T07:59:07.1667819Z FAIL status --unused: Failed to parse unused-key count: …
2026-09-04T07:59:07.1678165Z FAIL status ko_KR: Failed to parse per-locale missing-key count for "ko_KR": …
2026-09-04T07:59:07.2157417Z  FAIL   app-unit  src/features/…/export-pages-to-fs-async.spec.ts > export-pages-to-fs-async: getPageWritable > PDF format smoke test (Requirements 5.1, 2.1) > links the shared stylesheet and wraps content in .wiki, writing the CSS once per job
…4 more of the same spec file…
2026-09-04T07:59:07.2205133Z  Test Files  1 failed | 309 passed (310)
2026-09-04T07:59:07.2205720Z       Tests  5 failed | 4151 passed (4156)
```

The first three lines are the i18n-audit tool printing its own result through
a test's stdout — the grep cannot tell them from a failure block, and a reader
applying Step 3 to them would file `FAIL unused-key count 80 exceeds baseline
10` as a flaky test identity. The last two are vitest's run totals, which Step
3's Playwright count rule must not read as a shard summary.

**After** — `vitest.failBlocks` has **5** entries, all
`src/features/page-bulk-export/server/service/page-bulk-export-job-cron/steps/export-pages-to-fs-async.spec.ts`,
the first with
`testTitle: "export-pages-to-fs-async: getPageWritable > PDF format smoke test (Requirements 5.1, 2.1) > links the shared stylesheet and wraps content in .wiki, writing the CSS once per job"`;
`playwright.annotations: []`; `playwright.summary: null`; `denylistHits: []`.

## `11849-repro-result-log-excerpt.txt` (real, literal `^[` caret text)

**Before — the `sed` removes nothing at all.** Every match still carries its
escape sequences, because the file contains zero `0x1b` bytes (see that
fixture's `.meta.md`):

```
^[[41m^[[1m FAIL ^[[22m^[[49m ^[[30m^[[45m app-components ^[[49m^[[39m src/client/components/Admin/Common/AdminCodeEditor.spec.tsx^[[2m > ^[[22mAdminCodeEditor^[[2m > ^[[22m…
```

6 matching lines, none of them usable as an identity without hand-editing.

**After** — `vitest.failBlocks` has **6** entries, project `app-components`,
spec path `src/client/components/Admin/Common/AdminCodeEditor.spec.tsx`,
the first with `testTitle: "AdminCodeEditor > theme following > applies the
dark theme when in dark mode"`; `playwright.summary: null`. The caret spelling
is stripped in `lib/ansi.ts` alongside the ESC spelling — see the comment
there.

## `11752-setup-hook-timeout-excerpt.txt` (real, shared setup-hook timeout)

**Before — 3 matching lines**, the three file-level FAIL lines. The hook's
error and its `❯ test/setup/migrate-mongo.ts:36:1` frame — the only thing that
tells a shared setup hook from a spec file's own hook — do **not** match the
grep and are lost.

**After** — 3 fail blocks, each `testTitle: null` (a file-level FAIL line
names no test), `sharedSetupHook` `[false, false, true]`: the frame is printed
once, under the third block, so only that block carries the fact. Folding the
three into one identity stays the procedure's judgment.

## `11903-playwright-flaky-excerpt.txt` (real, `0 failed / 1 flaky`)

**Before — 3 matching lines**: the `::error` line, `  1 flaky`,
`  106 passed (5.7m)`. Splitting `file=` from `title=` is then done by eye.

**After** — one annotation
(`file: "apps/app/playwright/20-basic-features/inline-comment.spec.ts"`,
`title: "[chromium] › playwright/20-basic-features/inline-comment.spec.ts:4758:3 › Inline comment - visual refresh: mockup cross-check captures › Capture popover states 5 (normal) and 6 (edit mode) in DARK mode (Req 4.4)"`),
`summary: { failed: 0, flaky: 1, passed: 106, skipped: 0 }` — the absent
`failed` line reads as `0` because a summary **was** captured.

## `11914-playwright-flaky-excerpt.txt` (real, summary echoed under `##[notice]`)

**Before — 4 matching lines**: `1 flaky`, `106 passed (5.5m)`,
`##[notice]  1 flaky`, `106 passed (5.5m)`. Adding them up gives `2 flaky` /
`212 passed` for a shard that had one flaky test.

**After** — `summary: { failed: 0, flaky: 1, passed: 106, skipped: 0 }`
(first reading per keyword wins), `annotations: []`.

## `constructed-playwright-1-failed-0-flaky-excerpt.txt`

**Before — 3 matching lines**: the `::error` line, `  1 failed`,
`  105 passed (5.9m)`.

**After** — one annotation,
`summary: { failed: 1, flaky: 0, passed: 105, skipped: 0 }`.

## `constructed-97-failures-one-infra-noise-excerpt.txt`

**Before — 97 matching FAIL lines.** The procedure's denylist step is prose,
not a command: a reader is told to match "the failure's own excerpt", but the
grep output above has no excerpts in it, only FAIL lines. Searching the
**whole** log for `getaddrinfo ENOTFOUND` — the shortcut the procedure
explicitly warns against — matches, and would drop all 97.

**After** — 97 fail blocks and exactly **one** entry in `denylistHits`:

```json
{ "blockIndex": 42,
  "specPath": "src/server/service/feature-43/feature-43.integ.ts",
  "testTitle": "feature-43 suite > case 43 keeps its own identity",
  "pattern": "getaddrinfo ENOTFOUND",
  "needle": "getaddrinfo ENOTFOUND",
  "scope": "failure" }
```

`scope: "failure"` — the other 96 failures are untouched.

## `constructed-setup-hook-infra-noise-excerpt.txt`

**Before — 2 matching FAIL lines**; the `test/setup/` frame that makes this
the job-wide exception does not match the grep.

**After** — 2 fail blocks, both `sharedSetupHook: true`, and one denylist hit
at `blockIndex: 0` with `scope: "job"`. Acting on the `job` scope (dropping
every failure in this log) is the procedure's step, not the script's.
