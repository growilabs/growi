---
name: kiro-spec-cleanup
description: Organize and clean up specification documents after implementation completion. Removes implementation details while preserving essential context for future refactoring.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
argument-hint: <feature-name>
---

# kiro-spec-cleanup Skill

## Role

This skill fills the post-implementation gap in the spec lifecycle. After `/kiro-validate-impl` returns GO, spec documents accumulate implementation-specific content (testing procedures, deployment checklists, detailed code examples) that clutters future reading. This skill trims the HOW while preserving the WHY, so that the specs remain a useful reference when refactoring months later.

Beyond trimming after the fact, this skill installs the standard for *what a spec should contain at all* — the **Write / Don't-Write test** below — as the opening section of `design.md`. A spec is not a record of the implementation; it is the **starting point for the next change** to this feature. Content a reader could reconstruct from the code and test files does not belong in it: when the code changes, that content goes stale silently and drags down trust in the whole document. The cheapest cleanup is the content that was never written, so the test is meant to be applied both retroactively (this run) and prospectively (every future edit, because the test now lives in the document).

That framing governs the **explanatory** documents (`design.md`, `research.md`). It does not license trimming `requirements.md`'s Acceptance Criteria: those are the contract the next change is measured against, and they survive cleanup intact — see [What the test does not apply to](#what-the-test-does-not-apply-to-requirementsmds-acceptance-criteria).

Lifecycle position:

```
discovery → init → requirements → design → tasks → impl → validate-impl → **spec-cleanup**
```

This is orthogonal to [spec-lifecycle](../../rules/spec-lifecycle.md): that rule governs a spec that amends an already-completed spec's contract and must fold itself back and delete itself, while this skill trims a single spec's own documents after its own implementation lands. Run cleanup on every spec once it ships; run spec-lifecycle's final task only when the spec being closed out was itself an amend spec.

## Core Mission
- **Success Criteria**:
  - Implementation details (testing procedures, deployment checklists) removed
  - Design decisions, architectural constraints, and boundary metadata preserved
  - `requirements.md`'s numbered EARS Acceptance Criteria are still itemized and still at their original numbers (never collapsed into a summary paragraph, never renumbered)
  - Each requirement's closing note states the residual **un-testable** gap, not an enumeration of the tests that cover it
  - Unimplemented features removed or documented
  - Content a reader could reconstruct from the code and test files is gone (signatures, file inventories, mechanism walk-throughs, covered-test lists, traceability tables)
  - The **Write / Don't-Write test** is present as the opening section of `design.md`, so future edits self-limit
  - Sections that have served their purpose are removed, not annotated (a stale section, even with a correction note, is read as current)
  - Documents remain valuable for future refactoring work
  - All prose content matches the language in spec.json

## Organizing Principle

**"Can we read essential context from these spec documents when refactoring this feature months later — without anything in them having silently gone stale?"**

### The Write / Don't-Write test

Apply this one test to every keep/remove call, and leave it in the spec as `design.md`'s opening section so it governs future edits too. The guiding question for each piece of content is: **could a reader reconstruct this by reading the code and the test files?** If yes, it does not belong in the spec.

| Write it | Don't write it |
|---|---|
| Facts that took real research to reach — behavior that isn't obvious from a quick read of the code; hidden behavior of an external library | Function signatures, file-layout diagrams, "which file holds what" |
| Why an unusual design was chosen — **especially the shapes that were tried and rejected, and why** | Straightforward explanations of a straightforward implementation |
| What automated tests **cannot** catch (the residual gaps) | Enumerations of which tests cover what — read the spec/test files instead; the list rots |
| Manual verification procedure not derivable from code: how to build the reproduction environment, what to look at, the baseline/threshold values that mean pass/fail | Whether there is a diff, when it was implemented, and other point-in-time history |

**When in doubt, leave it out.** Code-readable content placed in a spec goes stale the moment the code changes, and one stale section costs the whole document its credibility.

### What the test does not apply to: requirements.md's Acceptance Criteria

The Write / Don't-Write test asks "could a reader reconstruct this from the code?" — a question that only makes sense for **explanatory** content. Never point it at `requirements.md`'s Acceptance Criteria. A criterion is not a description of the implementation; it is the **contract the implementation is measured against**. "The tests already encode it" is the intended end state of a requirement, not evidence that the requirement is redundant.

The numbered EARS list is also a set of **live identifiers** that other files point at by number:

- `tasks.md` cites them as `_Requirements: 1.3, 3.1_`
- `design.md` traces decisions back to them
- implementation and test files cite them in comments and test names (e.g. `(1.6)`, `(6.1)`)

So there are two distinct ways to break a spec here, and both have actually happened (2026-08-05, restored in commit `6bf45a133d`):

1. **Collapsing** `#### Acceptance Criteria` into one `**要約**:` paragraph deletes the targets those citations point at. (ai-agentic-search / ai-chat-page-mention / ai-provider-model-picker)
2. **Renumbering** — including the renumbering that falls out of merging two specs or deleting a requirement — silently re-points existing citations at the *wrong* requirement, which is worse than a dangling one. (suggest-path)

Rule: cleanup may add a closing note to a requirement and may fix genuinely broken wording inside a single criterion, but it must leave the list itemized and every number where it is. If numbering truly has to change, update every citing file in the same commit — otherwise renumber nothing.

### Two resolutions that override the coarser lists below

- **File Structure Plan** — keep the *decision* (which component owns what, and why the seams sit where they do); drop the literal file-by-file inventory, which after implementation is read more reliably from the tree. During active implementation the inventory drives task boundaries and stays; at cleanup it has done its job.
- **Verification procedures** — remove procedures that only restate what the test files and CI already encode (e.g. "run `pnpm vitest run X`", per-AC test lists); keep manual procedures a future reader could not reconstruct from the code (repro-environment setup, what to observe, baseline values).

- **Keep**: the numbered EARS Acceptance Criteria (the contract, not explanation), and the "Why" — design decisions and their rejected alternatives, architectural constraints, boundary commitments, limitations, trade-offs, residual un-testable gaps, non-reconstructable verification steps, Implementation Notes
- **Remove**: "How" the code already carries — signatures, file inventories, mechanism walk-throughs, requirement-traceability tables, technology-stack catalogs, covered-test enumerations, deployment steps, point-in-time history

## Execution Steps

### Step 1: Load Context

**Discover all spec files**:
- Glob `.kiro/specs/$ARGUMENTS/` to list every file
- Categorize:
  - **Core files** (must preserve): `spec.json`, `brief.md`, `requirements.md`, `design.md`, `tasks.md`, `research.md`
  - **Other files** (evaluate case-by-case): validation reports, notes, prototypes, migration guides, etc.

**Read all discovered files**:
- Read all core files first
- Read other files to understand their content and value

**Determine target language**:
- Read `spec.json` and extract the `language` field (e.g., `"ja"`, `"en"`)
- All spec document prose must be in this language
- Exempt: code inside fenced blocks, inline code spans, proper nouns, technical terms

**Verify implementation status**:
- Count `[x]` vs `[ ]` tasks in tasks.md
- If less than 90% complete, warn user and ask to confirm cleanup

### Step 2: Analyze Current State

**Identify cleanup opportunities across all files**:

1. **Other files** (non-core files like validation-report.md, notes.md, etc.):
   - Read each file to understand content and purpose
   - Identify valuable information worth preserving:
     * Implementation discoveries and lessons learned
     * Critical constraints or design decisions
     * Historical context for future refactoring
   - Determine salvage strategy:
     * Migrate valuable content to research.md or design.md
     * Keep file if it contains essential reference information
     * Delete if content is redundant or no longer relevant
   - **Case-by-case evaluation required** — never assume files should be deleted

2. **brief.md** (v3 discovery output):
   - Preserved in substance — it records the original problem, approach, scope, and boundary candidates from discovery
   - The only permitted edit is a one-line header marking it as a **discovery-time record** whose current truth lives in design/requirements where they differ; without it, a reader mistakes discovery-time guesses for current decisions
   - No other cleanup needed unless content duplicates other files

3. **research.md**:
   - Should contain discovery findings, design decisions, and implementation lessons
   - Check if implementation revealed new constraints or patterns to document
   - Identify content from other files that should be migrated here

4. **requirements.md**:
   - **The `#### Acceptance Criteria` lists are not cleanup targets.** They stay itemized, in EARS form, at their existing numbers. The only edit allowed inside a criterion is fixing wording that is actually wrong or unreadable, and only while its number and its testable meaning stay the same. Merging criteria, replacing the list with a paragraph, and renumbering are all out of scope for this skill
   - For each requirement's closing note, prefer stating what automated tests do **NOT** cover (the residual gap a future reader cannot derive) over enumerating the tests that do (that list duplicates the test files and rots)
   - Find unimplemented requirements (compare with tasks.md). Before proposing to remove one, grep the repo for its number (`_Requirements:`, `(N.M)`, `Requirement N`) — if anything cites it, keep the requirement and record its unimplemented status in the closing note instead
   - Detect duplicate or redundant content in the narrative parts (Overview, Objective, background prose) — not in the criteria

5. **design.md**:
   - Ensure the **Write / Don't-Write test** (see Organizing Principle) is present as the opening section; add it if missing, so future edits self-limit
   - Identify content that can be removed because the code and test files already carry it:
     * Detailed Testing Strategy that restates the test files/CI (keep only the test *approach* and any non-reconstructable manual verification procedure)
     * Function signatures, file-by-file inventories, and "which file holds what" maps
     * Exhaustive mechanism walk-throughs of a straightforward implementation
     * Requirement-traceability tables and covered-test enumerations
     * Technology-stack catalogs
     * Security Considerations (if fully addressed in implementation)
     * Error Handling code examples (if implemented)
     * Migration Strategy (after migration complete)
     * Deployment Checklist (after deployment)
   - Identify sections that MUST be preserved:
     * Architecture diagrams and Boundary Commitments
     * Component interfaces and API contracts
     * The File Structure Plan's boundary/decomposition **decision** (which component owns what and why the seams sit there) — but not the literal file inventory
     * Design decisions and rationale, **including the shapes that were tried and rejected and why**
     * Non-reconstructable verification procedures (repro-environment setup, what to observe, baseline/threshold values)
     * Out of Boundary declarations
     * Allowed Dependencies
     * Revalidation Triggers
     * Critical implementation constraints
     * Known limitations
   - **Remove superseded sections rather than annotating them**: a gap-analysis note now proven wrong, a one-off evidence table, a migration guide after migration — a section that has served its purpose is read as current even with a correction note, so drop it (a wrong-but-annotated section once caused a correct statement to be edited into an incorrect one)

6. **tasks.md**:
   - `## Implementation Notes` section MUST be preserved — it carries cross-task knowledge
   - `_Boundary:_` and `_Depends:_` annotations MUST be preserved — they document the boundary discipline
   - Task completion markers `[x]` should remain as historical record

7. **Language audit** (compare prose language vs. `spec.json.language`):
   - For each markdown file, scan prose content (headings, paragraphs, list items) and detect the written language
   - Flag any file or section whose language does not match the target language
   - Exemptions — do NOT flag:
     * Content inside fenced code blocks — code comments must stay in English
     * Inline code spans
     * Proper nouns, technical terms, and identifiers always written in English
   - Collect flagged items into a translation plan: file name, approximate line range, detected language, brief excerpt

### Step 3: Interactive Confirmation

**Present cleanup plan to user**:

For each file and section identified in Step 2, present recommendations and ask for approval. Group related decisions to reduce interruptions.

**Example questions for other files**:
- "validation-report.md found. Contains {brief summary}. Options:"
  - "A: Migrate valuable content to research.md, then delete"
  - "B: Keep as historical reference"
  - "C: Delete (content no longer needed)"

**Example questions for core files**:
- "requirements.md: Add residual-gap closing notes to Req 1–5? (Acceptance Criteria themselves stay untouched) [Y/n]"
- "requirements.md: Req 4 is unimplemented and no file in the repo cites its number. Remove it, leaving Req 5+ at their current numbers? [Y/n]"
- "design.md: Delete 'Testing Strategy' section (lines X-Y)? [Y/n]"
- "design.md: Keep Boundary Commitments and the File Structure Plan's decomposition decision, while dropping its literal file inventory? [Y/n]"

**Translation confirmation** (if language mismatches found):
- Show summary: "Found content in language(s) other than `{target_language}` in:"
  - List each flagged file with line range and short excerpt
- Ask: "Translate mismatched content to `{target_language}`? [Y/n]"

**Batch similar decisions**:
- Group related sections (e.g., all "delete implementation details" decisions)
- Allow user to approve categories rather than individual items

### Step 4: Execute Cleanup

**For each approved action**:

1. **Salvage and cleanup other files** (if approved):
   - For each non-core file:
     * Extract valuable information
     * Migrate content to appropriate core file:
       - Technical discoveries → research.md
       - Design constraints → design.md
       - Requirement clarifications → requirements.md
     * Delete file after salvage (if approved)
   - Document salvaged content with source reference

2. **Update research.md** (if new discoveries or salvaged content):
   - Add "Post-Implementation Discoveries" section if needed
   - Document critical technical constraints discovered during implementation
   - Integrate salvaged content from other files
   - Cross-reference requirements.md and design.md where relevant

3. **Update requirements.md** (if approved):
   - Leave the numbered EARS Acceptance Criteria itemized and at their original numbers
   - Add or adjust each requirement's closing note so it states the residual un-testable gap
   - Remove an unimplemented requirement only when nothing in the repo cites its number, and do not renumber the survivors — leave the gap in the sequence
   - Preserve requirement objectives

4. **Clean up design.md** (if approved):
   - Add the **Write / Don't-Write test** as the opening section if it is not already there
   - Delete approved implementation-detail sections and any superseded sections (do not merely annotate them)
   - Preserve: Architecture diagrams, Boundary Commitments, Out of Boundary, Allowed Dependencies, Revalidation Triggers, the File Structure Plan's boundary decision (not the file inventory), Component interfaces, Design decisions and their rejected alternatives, non-reconstructable verification procedures
   - Integrate salvaged content from other files if relevant

5. **Preserve tasks.md structure**:
   - Keep `## Implementation Notes` intact
   - Keep `_Boundary:_` and `_Depends:_` annotations intact
   - Keep task completion markers as historical record

6. **Preserve brief.md**:
   - No modifications to the body — discovery context is immutable
   - The only permitted edit is adding a one-line header marking it as a discovery-time record superseded by design/requirements where they differ

7. **Translate language-mismatched content** (if approved):
   - For each flagged section, translate prose to the target language
   - Never translate content inside fenced code blocks or inline code spans
   - Preserve all Markdown formatting

8. **Update spec.json metadata**:
   - Set `phase: "implementation-complete"`
   - Set `cleaned_up_at` to current ISO 8601 timestamp (e.g., `"2026-04-16T09:30:00.000Z"`)
   - Remove legacy `cleanup_completed` boolean if present (superseded by `cleaned_up_at`)
   - Update `updated_at` timestamp

### Step 5: Generate Cleanup Summary

Provide summary report in the language specified in spec.json:

```markdown
## Cleanup Summary for {feature-name}

### Files Modified
- file: action taken (lines changed)

### Information Salvaged
- Source → destination mapping

### Information Preserved
- Architecture diagrams and boundary commitments
- Design decisions and rationale
- Implementation Notes and boundary annotations
- Brief (discovery context)
- Known limitations and trade-offs

### Next Steps
- Spec documents ready for future refactoring reference
```

## Critical Constraints

- **User approval required**: Never delete or modify content without explicit confirmation
- **Boundary metadata is sacred**: Never remove Boundary Commitments, Out of Boundary, Allowed Dependencies, Revalidation Triggers, _Boundary:_, or _Depends:_ annotations
- **Implementation Notes are sacred**: Never remove the `## Implementation Notes` section from tasks.md
- **Acceptance Criteria and requirement numbers are sacred**: Never collapse `#### Acceptance Criteria` into a summary paragraph, and never renumber requirements. tasks.md (`_Requirements: N.M_`), design.md, and code/test comments cite these numbers — collapsing deletes what they point at, renumbering re-points them at the wrong requirement
- **brief.md is near-immutable**: Do not modify the body — it records the original discovery context; the only permitted edit is a one-line header marking it as a discovery-time record superseded by design/requirements where they differ
- **The Write / Don't-Write test is the standard for explanatory content**: keep out anything a reader could reconstruct from the code and test files; when in doubt, leave it out. It applies to design.md and research.md — not to requirements.md's Acceptance Criteria, which are the contract rather than a description of the code
- **Remove, don't annotate, superseded sections**: a section that has served its purpose is read as current even with a correction note — drop it
- **Language consistency**: All prose content must match `spec.json.language`; code blocks exempt
- **Preserve history**: Don't delete discovery rationale or design decisions (the WHY) — this is distinct from point-in-time implementation history (diff/timing), which is removed
- **Interactive workflow**: Pause for user input rather than making assumptions

## Safety & Fallback

### Error Scenarios

**Implementation Incomplete**:
- **Condition**: Less than 90% of tasks marked `[x]` in tasks.md
- **Action**: Warn: "Implementation appears incomplete (X/Y tasks done). Continue cleanup? [y/N]"
- **Recommendation**: Run `/kiro-validate-impl {feature}` first

**Spec Not Found**:
- **Message**: "No spec found for `$ARGUMENTS`. Available specs:"
- **Action**: List available spec directories in `.kiro/specs/`

**Missing Critical Files**:
- **Condition**: requirements.md or design.md missing
- **Action**: Skip cleanup for missing files, proceed with available files
- **Warning**: "{file} missing — cannot clean up"

### Backup Recommendation

Before cleanup:
- Recommend user commit current state: "This will modify spec files. Consider committing current state for easy rollback."
- Undo path: `git checkout HEAD -- .kiro/specs/{feature}/`

### Related Commands

- `/kiro-validate-impl {feature}` — run before cleanup to confirm GO
- `/kiro-spec-status {feature}` — check implementation progress
