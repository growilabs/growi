# Source

- **Real.** `gh api -X GET repos/growilabs/growi/issues/11823/events --paginate`.
- Issue [#11823](https://github.com/growilabs/growi/issues/11823) — has a
  `labeled` event for `flaky/needs-decision` at `2026-09-14T15:57:36Z`,
  **before** the automated "Paused — awaiting a human decision" comment at
  `2026-09-14T15:57:37Z` (see `11823-comments.json`) — the "label added
  before the recommendation comment" (normal) ordering for
  `awaiting-decision-rows`.
- **Captured**: 2026-09-16.
