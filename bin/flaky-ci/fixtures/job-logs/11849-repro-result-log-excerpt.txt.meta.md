# Source

- **Real.** The fenced excerpt inside the real `### Repro result` comment on
  [issue #11849](https://github.com/growilabs/growi/issues/11849), posted
  `2026-09-14T14:26:11Z` by the `flaky-repro` workflow (comment id
  `5665550103`). Extracted with:
  `gh api -X GET repos/growilabs/growi/issues/11849/comments --paginate -q '.[] | select(.body|startswith("### Repro result")) | .body'`,
  then the text between the ```` ```` ```` fences.
- **Important, verified finding — this is NOT the byte the procedure's
  ANSI-stripping code expects.** The stack-trace frames are byte-for-byte as
  returned by the GitHub API (not re-typed or re-colored), but checked at
  the byte level (`python3 -c "... .read() ..."` and `gh api` with no `jq`
  post-processing, to rule out `jq -q` re-escaping anything): every `^[` in
  this file is the **literal two-character sequence** `^` (`0x5e`) + `[`
  (`0x5b`) — **not** the real ESC control byte `0x1b` that
  `bin/flaky-ci/lib/ansi.ts`'s `CSI_SEQUENCE` regex
  (`/\x1b\[[0-9;]*[A-Za-z]/g`) matches. `python3 -c "data.count(b'\x1b')"`
  on this file returns `0`; `data.count(b'^[')` returns `258`. So whatever
  posted this `flaky-repro` comment (the workflow step that captures
  vitest's colored reporter output and pastes it into the issue comment)
  already rendered control bytes as visible caret-notation before posting —
  the comment body GitHub actually stores contains no raw ESC bytes at all.
  **`ansi.strip()` as currently written will not touch this real fixture** —
  neither of the two sed forms the procedures used to carry
  (`s/\x1b\[[0-9;]*m//g` / `s/\x1b\[[0-9;]*[A-Za-z]//g`) matches literal
  caret-bracket text either, so this is a genuine third real-world input
  shape beyond the two `research.md` already reconciled. Left as-is
  (unmodified real data) rather than converted to real ESC bytes, precisely
  so this gap is visible to whoever builds `parse-job-log.ts` (task 3.1) —
  it needs a rule for this shape too, or an explicit decision to leave it
  unstripped.
- This is the **same incident** as `lockfile/11886-pnpm-lock.patch`: the
  stack trace runs through
  `.pnpm/@codemirror+state@6.7.1/node_modules/@codemirror/state/dist/index.js`,
  the exact package the lockfile patch resolves to two versions
  (`6.7.1` direct dependency vs. `6.7.4` via `@codemirror/view`). Issue
  #11849's root-cause comment (`### 原因確定 ...`) names the PRs that
  produced this; `README.md` explains why #11886 was picked as the
  paired lockfile fixture among the several it names.
- **Captured**: 2026-09-16.
