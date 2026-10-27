# `list-candidate-runs` fixtures — provenance

Recorded 2026-09-16 from the real `growilabs/growi` repository (read-only,
`gh api -X GET`, no state mutated):

```bash
gh api -X GET "repos/growilabs/growi/actions/workflows/ci-app.yml/runs" \
  -f status=completed -F per_page=5 -F "page=<1|2|3>"
```

`per_page=5` (instead of the real `100`) keeps the fixture small while still
producing 3 real pages from the live "Node CI for app development" workflow.
Each page file (`list-candidate-runs-ci-app-page{1,2,3}.json`) keeps only the
fields `list-candidate-runs.ts` reads: `id`, `conclusion`, `head_sha`,
`created_at`, `html_url`, `event`, `run_attempt` (plus `total_count`, which the
script ignores). `total_count` at capture time was `9221`.

## Old-procedure output for comparison (Requirement 1.3)

The current `detect-flaky-ci/SKILL.md` Step 1 shell (manual `while` loop over
`gh api` + `jq`, see the procedure text before this task's replacement) was run
by hand against the same live endpoint and produced, for these 3 pages, the
same 15 `{databaseId, conclusion, headSha, createdAt, url, event, attempt}`
objects as `jq -c '.workflow_runs[] | {databaseId: .id, conclusion, headSha:
.head_sha, createdAt: .created_at, url: .html_url, event, attempt:
.run_attempt}'` applied to each page above — field names differ only in
`databaseId` vs. this spec's `id` (design.md's contract table for
`list-candidate-runs` names the field `id`, not `databaseId`; the shell
snippet's local variable name was never part of any downstream contract, so
this is a rename, not a behavior change per Requirement 1.3).

`list-candidate-runs.spec.ts`'s combined-pages test asserts the script's
output against exactly this old-procedure output (rewritten with `id`), for a
`--window-hours` value that crosses from page 2 into what would be page 3
(cutoff `2026-09-16T06:00:00Z` against a fixed `now` of
`2026-09-16T10:00:00Z`), confirming the script stops paging at the same point
the manual loop's `oldest_epoch -lt CUTOFF_EPOCH` check would have.
