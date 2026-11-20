# Source

- **Real.** `gh api -X GET repos/growilabs/growi/issues/11823/comments --paginate`
  (flattened; the `.slurp.json` sibling in this directory is the same data
  in the `--slurp`-wrapped page-array shape `gh api ... --paginate --slurp`
  actually returns).
- Used together with `11823-events.json` for the "normal ordering"
  `awaiting-decision-rows` case, and on its own for the `read-repro-result`
  "read the tally for a given commit" case (it carries the two
  `### Repro result` comments for #11823's two commits).
- **Captured**: 2026-09-16.
