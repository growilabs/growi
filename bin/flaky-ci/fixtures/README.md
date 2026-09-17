# `bin/flaky-ci/fixtures/`

Real-data-sourced material for the Phase 1 scripts (`read-repro-result`,
`newest-observation`, `awaiting-decision-rows`, `lockfile-overlap` — tasks
2.1–2.4). Collected 2026-09-16 via `gh api` against the real
`growilabs/growi` repository (public, open-source; no redaction needed per
`.claude/rules/security.md`). Phase 2 tasks (3.x) add their own material
under the same layout as they land.

## Layout

```
fixtures/
├── api/
│   ├── issues/    # gh api issue / comments / events responses
│   ├── dashboard/ # the real dashboard issue's body, and the input it was built from
│   └── pulls/     # gh api pulls/{n}/files responses
├── lockfile/      # a PR's pnpm-lock.yaml patch, plus a derived package-name list
├── job-logs/      # a job-log excerpt, byte-for-byte as GitHub stored it
└── expected/      # "before" output: what the CURRENT shell-based procedure
                    # returns for each fixture above, plus the exact pipeline
                    # run to get it. Tasks 2.1-2.4's tests hardcode these same
                    # values as their `expect(...)` literals — the .md files
                    # here are the human-readable derivation record, not
                    # something the tests read at run time (the one exception
                    # is `expected/parse-identity-key-titles.json`, which
                    # `lib/identity.spec.ts` does load directly).
```

Every data file under `api/`, `lockfile/`, `job-logs/` has a sibling
`<name>.meta.md` recording:
- **Source** — issue / PR / run number, real or synthetic
- **Captured** — the date it was fetched (or, for a derived file, computed)
- For a synthetic file: why no real example could be found, and which real
  response its shape was copied from

## Real vs. synthetic

Two scenarios in the task list turned out to have **zero** real examples in
`growilabs/growi` after a deliberate search (documented per-file below):

- **Two `### Repro result` comments naming the same commit SHA.** A GitHub
  search (`search/issues -f q='repo:growilabs/growi "Repro result"
  in:comments'`) returns every issue that has ever carried such a comment —
  only 3 repo-wide (#11819, #11823, #11849) — and none of the three has two
  comments for the same commit (#11819 and #11823 each have two comments,
  but for two *different* commits: the pre-fix confirmation SHA and the
  post-fix verification SHA). `api/issues/synthetic-duplicate-sha-repro-result.slurp.json`
  is constructed from real comment #5667125454 on #11823, verbatim in shape,
  with only id/timestamp/body changed to add a second "manual re-run"
  comment for the same SHA.
- **`flaky/needs-decision` labeled-event with no readable timestamp**
  (empty `PAUSED_AT`). All 13 issues currently carrying the label have a
  readable `labeled` event. `api/issues/synthetic-no-labeled-event-11823-events.json`
  is the real `#11823` events response with only the one
  `flaky/needs-decision` "labeled" event removed (simulating a truncated
  event log, which is the cause the procedure text itself names).

One scenario the task description worried might need a synthetic turned out
to have a **real** example:

- **`flaky/needs-decision` label added *after* the recommendation comment**
  (the reversed ordering, tasks.md 2.3's "−1 second" case). Issue **#11914**
  is real: the comment carrying `- Recommendation: ...` was posted at
  `2026-09-14T19:45:44Z`, and the `flaky/needs-decision` "labeled" event
  fired one second later, at `2026-09-14T19:45:45Z` — see
  `api/issues/11914-comments.json` / `11914-events.json` and
  `expected/awaiting-decision-rows.md`.

One more synthetic fixture was added because no real flaky-tracking issue
lacks a `### First observation` `Date:` line (every one of them was created
by `detect-flaky-ci`'s template, which always includes one):
`api/issues/synthetic-no-date-issue.json` — a hand-labeled issue shape with
no body Date and no observation comments, used for the "date cannot be
read" exit-2 case of `newest-observation`.

## The `@codemirror/state` lockfile PR

`research.md` and `detect-flaky-ci/SKILL.md` (the `- ① not applicable:
lockfile changed `@codemirror/state`...` example line) already reference
this incident. Issue **#11849**'s
`### 原因確定` comment names the real dependabot PRs whose regenerated
`pnpm-lock.yaml` caused `@codemirror/state` to resolve to two versions
(6.7.1 direct dependency vs. 6.7.4 via `@codemirror/view` /
`@codemirror/theme-one-dark`): **#11846, #11886, #11887, #11888**. Of
these, #11846 turned out not to touch `@codemirror/*` at all (it's an
`orval` bump; caught by grepping each candidate's patch for `codemirror`
before choosing one — see `lockfile/11886-pnpm-lock.patch.meta.md`); #11886,
#11887 and #11888 all carry the identical `@codemirror/*` hunk (dependabot
regenerated the same stale lockfile against master for all three). **#11886**
was used as the substitute for the "already the codemirror/state PR" case
brief.md and detect's SKILL.md refer to by name — no single PR number is
pinned in those documents themselves, so this is a substitution of "which
one of several identical-hunk PRs" rather than a substitution of the
underlying incident.

The log excerpt in `job-logs/11849-repro-result-log-excerpt.txt` is the
**real** `### Repro result` comment's fenced excerpt from #11849 itself —
the same incident, not a different one glued on: its stack trace runs
through `.pnpm/@codemirror+state@6.7.1/...`, the exact package/version the
lockfile patch above changes.

**Byte-level finding, and how it was resolved**: this excerpt's "ANSI" codes
are not real ESC (`0x1b`) bytes — they are the literal two-character text
`^[`, verified at the byte level (see the fixture's own `.meta.md`). Neither
of the two ANSI-stripping regexes `research.md` reconciled into `lib/ansi.ts`
matches that shape. Task 3.1 handled it by teaching `ansi.strip` the second
spelling rather than giving `parse-job-log.ts` a stripper of its own: both
spellings are real production input (the job-log endpoint returns ESC bytes;
an excerpt pasted into an issue comment by `flaky-repro` arrives as caret
text), and two strippers would be the same drift `ansi.ts` was created to
end. The reasoning is in that module's header comment.

## Phase 2 material (`job-logs/`, task 3.1)

`parse-job-log` added seven more log fixtures — four real, three constructed —
each with its own `.meta.md` saying which it is and why:

| File | Real? | What it pins |
|---|---|---|
| `ci-app-test-100952911197-excerpt.txt` | real | ESC bytes and timestamps; three `FAIL `-prefixed lines that are **not** vitest failures; vitest's own totals, which must not be read as a Playwright summary |
| `11752-setup-hook-timeout-excerpt.txt` | real | file-level FAIL lines (no test title); the `test/setup/` frame printed once, under the last of three |
| `11903-playwright-flaky-excerpt.txt` | real | one mid-line `::error` annotation; `0 failed / 1 flaky` |
| `11914-playwright-flaky-excerpt.txt` | real | the shard summary echoed a second time under `##[notice]` — counting it twice would report `2 flaky` |
| `constructed-97-failures-one-infra-noise-excerpt.txt` | constructed | 97 failures, exactly one infrastructure-noise hit, `scope: "failure"` — the per-failure-not-per-job rule |
| `constructed-playwright-1-failed-0-flaky-excerpt.txt` | constructed | the mirror of #11903: a captured summary whose absent line reads as `0` |
| `constructed-setup-hook-infra-noise-excerpt.txt` | constructed | a denylist string inside a `test/setup/` hook → `scope: "job"` |

The searches that established "no real example exists" for the three
constructed ones are recorded in their `.meta.md` files.

## Phase 2 material (`identity/`, task 3.3)

`parse-identity-key` added `identity/flaky-issue-titles.json` — all 65 issue
titles currently carrying a `flaky/*` tracking label, real — and
`identity/constructed-titles.json` — 2 constructed titles, one per shape
that has no real example anywhere in `growilabs/growi`'s issue history
(`playwright:{BROWSER}` job-level fallback, and a malformed `vitest:` key
with no source-file extension). Both files' `.meta.md` record the exact
searches. `expected/parse-identity-key-titles.json` and
`expected/parse-identity-key.md` hold the per-title expectation (what the
current regex-and-4-step procedure gives for each). `lib/identity.spec.ts`
loads the `.json` file directly and checks against it; the `.md` file is the
same expectation in human-readable prose, not read by the test.

## Phase 2 material (`api/dashboard/`, task 3.10)

`render-dashboard` is checked against the real thing: `11720-body.md` is the
body issue **#11720** (`flaky-ci-routine: dashboard`) carried after the
2026-09-16T00:12:47Z run, and `render-dashboard-input.json` is the material
that run had in hand, captured with the two scripts that now feed the
renderer (`fetch-flaky-issues` filtered to `state: "open"`, and
`awaiting-decision-rows` over the 13 open `flaky/needs-decision` issues).
`lib/dashboard.spec.ts` renders the input and compares it to the body
character for character; it matches exactly. Each file's `.meta.md` records
how it was captured, and `expected/render-dashboard.md` says what the pair
pins.

The three zero states and the character-limit truncation have no real example
— the dashboard has never had an empty table, and no body has come near 65536
characters — so they are covered by constructed inputs inside
`lib/dashboard.spec.ts` rather than by a fixture file.
