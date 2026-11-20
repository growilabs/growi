# Source

- **Real.** The fenced excerpt inside the `### Evidence` section of the body of
  [issue #11752](https://github.com/growilabs/growi/issues/11752) — the
  tracking issue for `test/setup/migrate-mongo.ts`'s shared setup-hook
  timeout. Extracted with
  `gh api -X GET repos/growilabs/growi/issues/11752 -q '.body'`, verbatim
  between the fences.
- **Why this one**: it is the real shape of a shared setup-hook timeout, and
  it carries two things a constructed example would have got wrong.
  - The three `FAIL` lines are **file-level**: `FAIL app-integration
    src/…/g2g-transfer-preflight.integ.ts [ src/…/g2g-transfer-preflight.integ.ts ]`
    — the spec path appears twice and there is no ` > suite > test` part at
    all, so `testTitle` must be `null` rather than invented from the repeated
    path.
  - The hook's error and its frame (` ❯ test/setup/migrate-mongo.ts:36:1`) are
    printed **once, under the last of the three FAIL lines**. So the
    "resolves under `test/setup/`" fact is true of that one block only —
    `extractFailBlocks` reports `sharedSetupHook` per block and does not
    back-propagate it. Folding the three spec files into one identity is the
    procedure's judgment, which is exactly why this module must not guess it.
- **Captured**: 2026-09-16.
