# Spec Lifecycle (how to handle a spec that amends an earlier one)

This rule forces **a spec created to change an already-completed spec's contract**
(called an *amend spec* below) to be treated as a temporary vehicle. An amend spec is
not done when its implementation lands — it is done only after it has ported its
changes back into the target spec and **deleted itself**.

The 3-phase approval workflow (Requirements → Design → Tasks → Implementation) itself
is defined by [CLAUDE.md](../../CLAUDE.md) and the `kiro-*` skills — this rule does not
restate it. It only covers what to do when you want to change a spec that already
shipped: where the change lives while in progress, and how it gets folded back in when
done.

## Why this rule exists

Opening a completed spec and editing it directly makes the diff unreadable — approved
content and the new change get mixed together. So the change is cut out into a new
spec. That much is already correct practice.

The failure mode is **not folding it back afterward**, which splits the source of
truth in two. If the amend spec goes stale before it is folded in, you get the worst of
both worlds: the amend spec rots, *and* the target spec stays wrong.

This repo already has a working precedent for doing this correctly: the activity-log
family was split into three specs (`activity-log-snapshot`, `activity-log`,
`activity-log-snapshot-viewer` — see [[project_activity_log_family_decomposition]] in
memory), and once each landed, `roadmap.md` records deleting the completed entries and
moving anything worth keeping into `spec.json`'s `increment_note` and the flagship
spec's `brief.md` (see the `roadmap.md` footer, updated 2026-08-07). That is the target
behavior this rule generalizes: fold the change in, then remove the now-redundant spec
entry — don't leave a live cross-reference to a spec that has nothing left to say.

## Principle: an amend spec isn't done until it deletes itself

Write the port-back-and-delete step as **the amend spec's own final task in its
`tasks.md`** — a procedure, not an intention, so it cannot be skipped.

```markdown
- [ ] N. Port changes into the target spec and retire this spec
  - [ ] N.1 Rewrite the relevant section(s) of <target-spec>'s design.md / requirements.md
  - [ ] N.2 Move any design rationale into <target-spec>'s research.md
  - [ ] N.3 Update <target-spec>'s spec.json (`updated_at`; leave `phase`/`approvals` alone)
  - [ ] N.4 Remove this spec's row/entry from roadmap.md (if listed there)
  - [ ] N.5 Delete .kiro/specs/<this amend spec>/
```

Implementation landing is not the completion point — **this final task is**.

## Procedure

### 1. When opening the amend spec — declare the target up front

Put an "**Amend target**" section in `brief.md` and `design.md` listing **which spec,
and which part of its contract, changes**. If more than one spec is affected, list all
of them.

If the change touches a target spec's Revalidation Triggers (the conditions under
which a downstream spec needs to be re-checked), say so explicitly — a future
implementer reading the downstream spec needs that information.

### 2. While implementing — don't scribble revision notes into the target spec

Leave the target spec's body as-is. Don't add "this will change later" notes to it.
Keep the change's location to the amend spec alone, and let `roadmap.md`'s spec list
carry discoverability.

Adding inline revision notes means the port-back step later has to fix **both** the
body and the notes, and one of them gets missed.

### 3. When porting back — watch for these four things

**(a) Append new requirement IDs at the end; never renumber existing ones.**
Implementation code and tests may reference requirement numbers directly (e.g. a test
name asserting `Req 3.2`). Renumbering silently breaks those references.

**(b) Move design rationale ("why we chose this") into the target spec's research.md.**
Skip this and the same option gets re-litigated months later. The amend spec's
research.md disappears with its directory, so **move it out before deleting**.

**(c) Relocate anything steering references by name, don't delete it.**
If a file inside the amend spec's directory is referenced by name from
`.kiro/steering/` (a custom steering file, or `roadmap.md`), deleting the directory
breaks that reference. Move cross-cutting, reusable procedures into a steering custom
file (`/kiro-steering-custom`); move feature-specific rationale into the target spec's
research.md.

**(d) Rewrite the target spec's body as if the amend never happened.**
Don't leave "this used to be X, then we changed it" narration in the body — only
current facts belong there. History lives in git (same principle as this repo's
`spec.json` policy: no dated changelog in `notes`, chronology stays in git history).

### 4. After folding in

- Update the target spec's `spec.json` `updated_at` (`phase` / `approvals` stay as-is)
- Remove the amend spec's row from `roadmap.md` (if it was listed as an umbrella
  sub-spec or similar)
- Delete `.kiro/specs/<amend spec>/`

## What this does NOT apply to

- **A spec for new functionality** — if it doesn't change an already-shipped spec's
  contract, it isn't an amend spec. Keep it around as normal.
- **A change to a spec still in flight** — if the target spec hasn't finished the
  approval flow yet, edit it directly. No amend spec needed.
- **Steering updates** — owned by `/kiro-steering`, a separate concern from spec
  lifecycle.
- **`/kiro-spec-cleanup`** — trims a single spec's own HOW-heavy detail after its own
  implementation lands, keeping the WHY. That's a different axis (thoroughness within
  one spec) from this rule (folding one spec's changes into another and retiring the
  amend spec). Run both where they apply: cleanup on a spec after it ships, this rule's
  final task when it was itself an amend spec.

## Checklist

Confirm before treating an amend spec as complete:

- [ ] `brief.md` / `design.md` has an "Amend target" section listing every changed
      contract, per target spec
- [ ] Any touched Revalidation Triggers in the target spec are called out explicitly
- [ ] No revision notes were scribbled into the target spec's body during implementation
- [ ] `tasks.md`'s final task is "port back + self-delete"
- [ ] Requirement IDs were appended, not renumbered
- [ ] Design rationale was moved into the target spec's research.md
- [ ] Files referenced by steering were given a new home and the reference was
      repointed
- [ ] The target spec's body was rewritten as if the amend never happened (no history
      narration left behind)
- [ ] The target spec's `spec.json` `updated_at` was updated
- [ ] The amend spec's row was removed from `roadmap.md`
- [ ] `.kiro/specs/<amend spec>/` was deleted
