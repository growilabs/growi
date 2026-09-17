# Expected output — old Step A~C shell fragments (captured 2026-09-16)

The commands below are Step A~C of `detect-flaky-ci/SKILL.md`'s "Failures the
PR itself owns" check, exactly as written before this task's replacement,
run against real data. `pr-owns-failure.ts`'s output for the same inputs is
compared against these in `pr-owns-failure.spec.ts`.

## Ancestor case (commit `0d1a319a106b2a791e883170782e856f88b0e178`)

```
$ gh api -X GET repos/growilabs/growi/compare/master...0d1a319a106b2a791e883170782e856f88b0e178 -q .status
identical
```

`identical` → ancestor of `master`; old Step A stops here and skips B/C
entirely. `pr-owns-failure.ts` still computes `pulls[]`/`touchesSpec` for
this commit (see Implementation Notes for why), but the procedure's
judgment — go to Step 4 normally — is unchanged.

## Non-ancestor case (commit `807c3628fc85bbf29335840d004660ce8c195f64`)

```
$ gh api -X GET repos/growilabs/growi/compare/master...807c3628fc85bbf29335840d004660ce8c195f64 -q .status
diverged
```

```
$ gh api repos/growilabs/growi/commits/807c3628fc85bbf29335840d004660ce8c195f64/pulls -q '.[] | {number, base: .base.ref, state}'
{"number":11919,"base":"feat/185872-backlinks","state":"open"}
```

```
$ gh api -X GET repos/growilabs/growi/pulls/11919/files --paginate -q '.[].filename'
apps/app/src/features/backlinks/server/services/page-link-service-handlers.ts
apps/app/src/features/backlinks/server/services/page-link-sync.spec.ts
apps/app/src/features/backlinks/server/services/page-link-sync.ts
apps/app/src/features/backlinks/server/services/page-link-upsert-queue.spec.ts
apps/app/src/features/backlinks/server/services/page-link-upsert-queue.ts
```

`--spec-path src/features/backlinks/server/services/page-link-sync.ts`
matches (`apps/app/…page-link-sync.ts` ends with
`/src/features/backlinks/server/services/page-link-sync.ts`) → Step C would
**exclude**. `--spec-path src/some/unrelated/file.spec.ts` matches nothing →
Step C would let it through to Step 4.
