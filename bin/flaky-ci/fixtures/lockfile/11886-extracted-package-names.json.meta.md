# Source

- **Derived, not raw API data.** This is the full set of package names
  extracted from `11886-pnpm-lock.patch` by hand-applying the two rules
  `detect-flaky-ci/SKILL.md`'s "Package names from the lockfile patch"
  table currently documents (strip a trailing parenthesised peer-suffix
  group first, then split on the last `@`), because that section is prose
  + a table for an LLM to apply by reading the patch — there is no existing
  executable script to just run and capture the output of (unlike the other
  three Phase 1 scripts, which do have a literal shell/jq pipeline in the
  procedure text today).
- Computed 2026-09-16 with a short one-off Python script (not committed —
  it duplicates exactly the two documented rules) that:
  1. Matches `+`/`-` lines only.
  2. For a header line (`'@scope/name@version':` with nothing after the
     colon), strips **all** trailing balanced `(...)` groups (the
     documented example shows only one group, but this patch's
     `@tsed/platform-express` entry chains several —
     `(...)(...)...` — back to back; stripping only one leaves a
     corrupted name, so this implementation repeats the strip until no
     trailing `)` remains), then splits on the last `@`.
  2. For a dependency-entry line (`'name': version`), takes the quoted key
     directly.
- **Known rough edges surfaced by this real patch** (useful `事故事例`
  material for task 2.4's tests):
  - `'@marijn/find-cluster-break@1.0.4': {}` — pnpm's own leaf-package
    header shape for a package with no dependencies. It structurally
    matches *both* the header rule (quoted-key, colon) and, if the matcher
    is lenient about what counts as "nothing after the colon", could be
    misread as a dependency-entry line with value `{}`; this script's regex
    treats `{}` as non-empty and mis-extracts the name as
    `@marijn/find-cluster-break@1.0.4` (version still attached) rather than
    `@marijn/find-cluster-break`. Left in the output as `known-issue` below
    rather than silently hand-fixed, since task 2.4's implementation needs
    to decide how to handle this shape.
  - The intersection this fixture set actually cares about
    (`@codemirror/state`) is unaffected by the above; it is extracted
    correctly by both rules.
- **Fields**:
  - `packages`: the full extracted set (32 entries, including the known
    rough edge above, unmodified).
  - `known_issues`: notes the `@marijn/find-cluster-break@1.0.4` /
    `@marijn/find-cluster-break` duplication described above.
