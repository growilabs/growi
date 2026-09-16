# Source

- **Real.** `gh api -X GET repos/growilabs/growi/issues/11914/events --paginate`.
- Issue [#11914](https://github.com/growilabs/growi/issues/11914) — the
  `flaky/needs-decision` "labeled" event fires at `2026-09-14T19:45:45Z`,
  **one second after** the comment that carries
  `- Recommendation: ...` (`19:45:44Z`, see `11914-comments.json`). This is
  the real example of the reversed ordering tasks.md task 2.3 calls out
  ("旧手順の逆順、−1 秒") — found by checking every open
  `flaky/needs-decision` issue's label-vs-comment timestamps; this was the
  only one where the comment predates the label.
- **Captured**: 2026-09-16.
