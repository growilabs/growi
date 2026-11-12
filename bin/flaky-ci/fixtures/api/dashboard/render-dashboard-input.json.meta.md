# `render-dashboard-input.json`

- **Source**: real, and assembled exactly the way the procedure assembles it —
  no field was written by hand.
  - `issues[]`: `node bin/flaky-ci/scripts/fetch-flaky-issues.ts` (the three
    tier labels, its default), filtered to `state == "open"` — the "active"
    set Step 5 item 1 defines — and reduced to the fields the body needs
    (`number`, `title`, `labels`, `body`, `comments[].body`). 13 issues:
    #11752, #11802, #11817, #11818, #11821, #11823, #11836, #11851, #11858,
    #11862, #11900, #11903, #11914.
  - `awaitingDecision[]`: `node bin/flaky-ci/scripts/awaiting-decision-rows.ts`
    with one `--issue` per open `flaky/needs-decision` issue — the same 13.
  - `autoClosed`: all three lists empty, which is what the run that wrote
    #11720's body had in hand (its `## Auto-closed this run` section says
    `None.` with both bullet lines at `none.`).
  - `updatedAt`: `2026-09-16T00:12:47Z`, the `_Updated:_` line of that same
    body — the moment the run read from the clock, not a value any script
    computes.
- **Captured**: 2026-09-16, against the real `growilabs/growi` repository
  (public; no redaction needed per `.claude/rules/security.md`).
- **Pairs with**: `11720-body.md`, the body the procedure produced from this
  same material.
