# Source

- **Synthetic.** No open `flaky/needs-decision` issue currently has a
  missing/truncated `labeled` event — all 13 checked have one. This fixture
  simulates the truncated-event-log case the procedure text itself names as
  the cause of an empty `PAUSED_AT` (`### Pause ordering` /
  4-B docs: "an event log can be truncated for a very old issue").
- Built by taking the real, verbatim `11823-events.json` response and
  removing only the one `labeled` / `flaky/needs-decision` event from it —
  every other event (and its full shape) is real, untouched data from
  #11823.
- **Captured/constructed**: 2026-09-16.
