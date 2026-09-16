# Expected values — `newest-observation` (task 2.2)

What the **current** procedure (`flaky-ci-routine.md` §4-B, lines ~474-486
as of commit `14165274c0`) actually returns for the fixtures in
`../api/issues/`. Task 2.2's script and its tests must reproduce these same
values for the same inputs (Requirement 1.3).

Pipeline run (verbatim from the procedure, `{N}` substituted):

```bash
# body: the Date: line inside ### First observation, first match only
BODY_DATE="$(gh api repos/growilabs/growi/issues/{N} -q '.body' \
  | awk '/^### First observation/{f=1;next} /^### /{f=0} f && /^-?[[:space:]]*Date:/{sub(/^-?[[:space:]]*Date:[[:space:]]*/,"");print;exit}')"

# observation comments: one Date: per qualifying comment, first match only
COMMENT_DATES="$(gh api -X GET repos/growilabs/growi/issues/{N}/comments --paginate \
  -q '.[] | select(.body | split("\n")[0] | (startswith("### Additional observation") or startswith("### Backfilled observation")))
          | [ .body | split("\n")[] | select(test("^-?[ \t]*Date:")) ][0] // empty
          | sub("^-?[ \t]*Date:[ \t]*"; "")')"

NEWEST="$(printf '%s\n%s\n' "$BODY_DATE" "$COMMENT_DATES" | grep -v '^[[:space:]]*$' | sort | tail -1)"
```

Run against the real `growilabs/growi` repo on **2026-09-16**.

## Case 1 — real: body-only observation (issue #11900)

- `{N}=11900`
- Fixtures: `../api/issues/11900-issue.json`, `../api/issues/11900-comments.json`
- `BODY_DATE=2026-09-11T17:47:16Z`
- `COMMENT_DATES=` (empty — #11900 has no `### Additional observation` /
  `### Backfilled observation` comments, only two consolidation notes and a
  "Paused" migration comment)
- `NEWEST=2026-09-11T17:47:16Z`

## Case 2 — real: observation comment present, newer than the body (issue #11821)

- `{N}=11821`
- Fixtures: `../api/issues/11821-issue.json`, `../api/issues/11821-comments.json`
- `BODY_DATE=2026-08-27T12:49:11Z`
- `COMMENT_DATES`:
  ```
  2026-08-27T13:02:00Z
  2026-09-02T15:43:58Z
  ```
  (the first from the `### Backfilled observation` comment, the second from
  the `### Additional observation (genuine recurrence after claimed fix —
  reopened, escalated to confirmed)` comment)
- `NEWEST=2026-09-02T15:43:58Z`

## Case 3 — synthetic: no date anywhere (exit-2 case)

- `{N}=` synthetic (see `../api/issues/synthetic-no-date-issue.json`'s
  `.meta.md` — no real flaky-tracking issue lacks a body `Date:` line, since
  all of them are filed by `detect-flaky-ci`'s template)
- Fixtures: `../api/issues/synthetic-no-date-issue.json`,
  `../api/issues/synthetic-no-date-comments.json` (empty array)
- `BODY_DATE=` (empty)
- `COMMENT_DATES=` (empty)
- `NEWEST=` (empty). The current procedure (§4-D, "A date that cannot be
  read is never a reason to close") already treats an empty `NEWEST` as "do
  not close, note in Step 6" rather than crashing — task 2.2's script must
  turn this into exit code 2 so 4-D's existing text keeps working unchanged
  (Requirement 3.3/3.4).
