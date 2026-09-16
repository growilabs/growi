# Expected value — `render-dashboard` (task 3.10)

The expected output is not a summary written out here: it is the **whole
body** of the real dashboard issue, `../api/dashboard/11720-body.md`, which
the routine's own prose procedure produced on its 2026-09-16T00:12:47Z run.
`lib/dashboard.spec.ts` renders `../api/dashboard/render-dashboard-input.json`
— the same issue list and the same awaiting-decision rows that run had in
hand, captured with the two scripts that now feed this one — and compares the
result against that file character for character (Requirement 1.3).

The comparison passes exactly, so nothing about the body had to be adjusted to
make the script reproduce it.

What the pair therefore pins, without any of it being restated as prose here:

- the row order (tier `confirmed` → `suspected` → `observing`, then tracking
  issue number ascending) — visible as the 7 confirmed rows before the 6
  suspected ones in `11720-body.md`;
- every column of the table, including Occurrences (#11752's `17` is 1 for the
  body plus 16 observation comments out of its 22 comments — the other 6, its
  `### Repro result`, Fix PR marker and investigation comments, are excluded
  by the first-line heading match), First / Last seen (read from `Date:`
  lines: #11752's `2026-08-21T07:25:12Z` comes from the body's
  `### First observation`, its `2026-09-14T14:22:03Z` from the newest of the
  16 comments, two of which are `### Backfilled observation`), and the Fix PR
  cells (four links — #11752, #11821, #11851, #11858 — and nine em dashes);
- the `## Awaiting human decision` section ordered by `Paused at` oldest
  first, with all 13 recommendations copied verbatim (none of them is
  `widened`, so none carries the `(may be stale) ` prefix — that case is
  covered by a dedicated unit test instead, since the prefix is applied by
  `awaiting-decision-rows.ts` and must not be applied a second time here);
- the `## Auto-closed this run` section in its zero state: `None.` followed by
  both bullet lines at `none.`;
- the trailing `---` + Claude Code signature, which Step 5 item 5's format
  list does not mention but every real body carries.

The three zero states, the truncation rule and its sub-rule have no real
example — the dashboard has never had an empty table, and no body has ever
come near 65536 characters — so they are covered by constructed inputs in
`lib/dashboard.spec.ts` rather than by a fixture here.
