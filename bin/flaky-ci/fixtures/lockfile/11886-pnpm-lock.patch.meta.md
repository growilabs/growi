# Source

- **Real.** Extracted with
  `gh api -X GET repos/growilabs/growi/pulls/11886/files --paginate -q '.[] | select(.filename=="pnpm-lock.yaml") | .patch'`
  (the exact command `detect-flaky-ci/SKILL.md`'s lockfile-overlap section
  currently documents) against PR #11886.
- Was chosen after checking all four PRs #11849's root-cause comment names:
  `#11846` (orval bump) does not touch `@codemirror/*` at all
  (`grep -c codemirror` on its patch = 0); `#11886`, `#11887` and `#11888`
  all carry the identical `@codemirror/state`/`@codemirror/view` hunk
  (dependabot regenerated the same stale lockfile against master
  independently for each). #11886 was picked arbitrarily among the three
  identical ones.
- **Captured**: 2026-09-16.
