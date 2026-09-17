# Expected values — `read-repro-result` (task 2.1)

What the **current** procedure (`investigate-flaky-test/SKILL.md` §2-D,
lines ~577-589 as of commit `14165274c0`) actually returns for the fixtures
in `../api/issues/`. Task 2.1's script and its tests must reproduce these
same values for the same inputs (Requirement 1.3).

Pipeline run (verbatim from the procedure, `ISSUE_NUMBER` and `REPRO_SHA`
substituted):

```bash
REPRO_RESULT_FILE="${TMPDIR:-/tmp}/flaky-repro-${ISSUE_NUMBER}.md"

gh api "repos/growilabs/growi/issues/${ISSUE_NUMBER}/comments?per_page=100" --paginate --slurp \
  | jq -r --arg sha "$REPRO_SHA" '
      [ flatten[]
        | select(.body | startswith("### Repro result"))
        | select(.body | split("\n") | any(. == "- Commit: " + $sha)) ]
      | last // empty | .body' > "$REPRO_RESULT_FILE"

grep -m1 -E '^- Runs:' "$REPRO_RESULT_FILE"
grep -m1 -E '^- Failed:' "$REPRO_RESULT_FILE"
```

Run against the real `growilabs/growi` repo on **2026-09-16**.

## Case 1 — real: issue #11823, pre-fix confirmation commit

- `ISSUE_NUMBER=11823`, `REPRO_SHA=b9a64ded27e0ce4cc30a0563d5be5133db0f027a`
- Fixture: `../api/issues/11823-comments.json` (or the `.slurp.json` sibling)
- Output:
  ```
  - Runs: 3
  - Failed: 0
  ```
- Full matched comment body:
  ```
  ### Repro result

  - Commit: b9a64ded27e0ce4cc30a0563d5be5133db0f027a
  - Branch: flaky-repro/issue-11823-replace-procedure
  - Mode: file
  - Runs: 3
  - Failed: 0
  - Per-run: pass, pass, pass
  - Workflow run: https://github.com/growilabs/growi/actions/runs/34867613127
  ```
- Comment id: `5667125454`, `created_at: 2026-09-14T16:19:49Z`

## Case 2 — real: issue #11823, post-fix verification commit

- `ISSUE_NUMBER=11823`, `REPRO_SHA=89af5caf24803880c8b4f198a4efed956694cc55`
- Same fixture as Case 1 (the issue carries two `### Repro result`
  comments, one per commit)
- Output:
  ```
  - Runs: 3
  - Failed: 0
  ```
- Comment id: `5667128399`, `created_at: 2026-09-14T16:20:01Z`

## Case 3 — synthetic: two comments for the SAME commit ("last wins")

- `ISSUE_NUMBER=11823` (synthetic variant), `REPRO_SHA=b9a64ded27e0ce4cc30a0563d5be5133db0f027a`
- Fixture: `../api/issues/synthetic-duplicate-sha-repro-result.slurp.json`
  (see its `.meta.md` — no real same-SHA duplicate exists in this repo)
- Two comments both carry `- Commit: b9a64ded27e0ce4cc30a0563d5be5133db0f027a`:
  the real one (`created_at: 2026-09-14T16:19:49Z`, `Runs: 3` / `Failed: 0`)
  and a synthetic later "manual re-run" one
  (`created_at: 2026-09-14T16:25:03Z`, `Runs: 3` / `Failed: 1`).
- Output (the `jq` pipeline's `last` picks the later comment):
  ```
  - Runs: 3
  - Failed: 1
  ```

## Case 4 — real: no `### Repro result` comment for this commit at all

- `ISSUE_NUMBER=11821`, `REPRO_SHA=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef`
  (an arbitrary SHA that appears nowhere on this issue; #11821 has no
  `### Repro result` comments at all)
- Fixture: `../api/issues/11821-comments.json`
- Output: `$REPRO_RESULT_FILE` is **empty** (0 bytes); both `grep -m1` calls
  exit with status 1 and print nothing. The current procedure has no
  explicit "not found" signal beyond an empty file — task 2.1's script must
  turn this into exit code 2 (Requirement 3.3), which is exactly the gap
  this case documents.
