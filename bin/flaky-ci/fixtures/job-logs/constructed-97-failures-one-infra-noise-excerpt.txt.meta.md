# Source

- **Constructed** — and deliberately so. No real job log in `growilabs/growi`
  was available with the shape this fixture has to have: roughly a hundred
  vitest failures in **one** job log, exactly one of which is infrastructure
  noise. The real incident this models is the one recorded in the procedure
  and in the original spec's research notes: searching the **whole job log**
  for a denylist string would have discarded **96 unrelated failures** along
  with the one real infra failure, which is why the denylist is matched
  against each failure's own excerpt instead
  (`detect-flaky-ci/SKILL.md`, "Match per failure, not per job log").
- **What is copied from real data**: the line shapes. Each block is the
  reporter's real FAIL-line layout taken from
  `ci-app-test-100952911197-excerpt.txt` — the same ESC-byte colour sequences
  (`\x1b[41m\x1b[1m FAIL …`), the same `2026-09-04T07:59:07.xxxxxxxZ `
  timestamp prefix, the same ` > ` suite/test separators, the same ` ❯ ` stack
  frame line, and vitest's `⎯⎯[n/97]⎯` divider between failures.
- **What is constructed**: the multiplicity and the names. 97 blocks, spec
  paths `src/server/service/feature-NN/feature-NN.integ.ts` and titles
  `case NN keeps its own identity`, so that a wrong result is readable at a
  glance. The zero padding is deliberately inconsistent between the two —
  the path says `feature-01` while the title says `feature-1 suite` — so that
  a test asserting both cannot pass by accidentally reading one from the
  other; it is not a generator slip. Failure 43 (index 42) is the single
  infrastructure-noise one, with
  `Error: getaddrinfo ENOTFOUND elasticsearch`; the other 96 are ordinary
  `AssertionError`s. None of the blocks has a frame under `test/setup/`, so
  the expected scope of the one hit is `failure`, not `job`.
- **Generated**: 2026-09-16, by a throwaway Node one-liner (not kept: the file
  is the artifact, and regenerating it would only invite silent drift between
  the generator and the committed bytes).
