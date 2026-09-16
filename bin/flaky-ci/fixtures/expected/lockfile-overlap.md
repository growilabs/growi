# Expected values — `lockfile-overlap` (task 2.4)

What applying the **current** procedure's documented rules
(`detect-flaky-ci/SKILL.md`, "A `pnpm-lock.yaml` change is never
'unrelated' by default" section, lines ~148-227 as of commit `14165274c0`)
gives for `../lockfile/11886-pnpm-lock.patch` and
`../job-logs/11849-repro-result-log-excerpt.txt`.

**Note on how this "before" value was produced**, unlike the other three
Phase 1 scripts: this section of the procedure is prose plus a lookup table
for an LLM to apply by reading the patch — the current procedure text
contains only the *fetch* command (below), not an executable extraction
pipeline. So there is no existing `jq`/shell one-liner to just run and
capture stdout from for the extraction step itself; the "before" value here
is the two rules applied by hand (helped by a short, throwaway Python
script implementing exactly those two documented rules — see
`../lockfile/11886-extracted-package-names.json.meta.md` for exactly what
it did and the one known rough edge it hit on this real patch).

Fetch command (real, run against the real repo):

```bash
gh api repos/growilabs/growi/pulls/11886/files --paginate \
  -q '.[] | select(.filename == "pnpm-lock.yaml") | .patch'
```

Run 2026-09-16 — output saved verbatim at `../lockfile/11886-pnpm-lock.patch`.

## Lockfile-side package names (full set)

Applying "strip a trailing parenthesised group first, then split on the
last `@`" (header lines) and "take the quoted key directly" (dependency
lines) to every `+`/`-` line of the patch above gives the 32 names in
`../lockfile/11886-extracted-package-names.json`'s `packages` array. The
one relevant to this fixture set:

- **`@codemirror/state`** — direct dependency changes `6.7.1` → `6.7.4`
  (from `-      '@codemirror/state': 6.7.1` / `+      '@codemirror/state':
  6.7.4`), and is also newly introduced as a *transitive* resolution via
  `@codemirror/view`'s updated `'@codemirror/view@6.43.11':` snapshot entry.

## Log-excerpt-side package names

Applying "cut the `.pnpm/` segment at the first `_`, then split on the last
`@`, then `+` → `/`" (and the plain-`node_modules/` variant) to every `❯`
frame in `../job-logs/11849-repro-result-log-excerpt.txt` gives:

- `@codemirror/state` (from `.pnpm/@codemirror+state@6.7.1/...`, 7 frames)
- `@uiw/react-codemirror` (from
  `.pnpm/@uiw+react-codemirror@4.23.8_@babel+runtime@7.29.7_@codemirror+autocomplete@6.18.4_@cod_.../...`,
  cut at the first `_`)
- `react-dom` (from `.pnpm/react-dom@18.2.0_react@18.2.0/...`, 3 frames)
- `react` (from `.pnpm/react@18.2.0/...`, 2 frames)
- `@testing-library/react` (from
  `.pnpm/@testing-library+react@16.0.1_@testing-library+dom@10.4.1_@types+react-dom@18.3.0/...`,
  cut at the first `_`, 3 frames)

## Intersection (the fact `lockfile-overlap` must return)

```
{ "@codemirror/state" }
```

This is a single-element intersection — `@codemirror/view` (the other
lockfile-side package that actually changed) does not itself appear in any
stack frame, only `@codemirror/state` does. Per the procedure's rule ("If
any package name appears in both sets, ① does not fire for this failure"),
this real PR/log pairing is exactly the case the procedure's own worked
example already describes in prose:

```
- ① not applicable: lockfile changed `@codemirror/state` (versions 6.7.1 → 6.7.4) and the failure's stack trace runs through it
```

(that literal line is quoted from `detect-flaky-ci/SKILL.md` — task 2.4's
script does not need to reproduce that sentence, only the fact
`{"@codemirror/state"}` the sentence is built from; the sentence assembly
stays in the procedure per Requirement 2.1/2.3.)
