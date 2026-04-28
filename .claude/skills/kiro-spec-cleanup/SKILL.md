---
name: kiro-spec-cleanup
description: Organize and clean up specification documents after implementation completion. Removes implementation details while preserving essential context for future refactoring.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
argument-hint: <feature-name>
---

# kiro-spec-cleanup Skill

## Role

This skill fills the post-implementation gap in the spec lifecycle. After `/kiro-validate-impl` returns GO, spec documents accumulate implementation-specific content (testing procedures, deployment checklists, detailed code examples) that clutters future reading. This skill trims the HOW while preserving the WHY, so that the specs remain a useful reference when refactoring months later.

Lifecycle position:

```
discovery → init → requirements → design → tasks → impl → validate-impl → **spec-cleanup**
```

## Core Mission
- **Success Criteria**:
  - Implementation details (testing procedures, deployment checklists) removed
  - Design decisions, architectural constraints, and boundary metadata preserved
  - Requirements simplified (Acceptance Criteria condensed to summaries)
  - Unimplemented features removed or documented
  - Documents remain valuable for future refactoring work
  - All prose content matches the language in spec.json

## Organizing Principle

**"Can we read essential context from these spec documents when refactoring this feature months later?"**

- **Keep**: "Why" — design decisions, architectural constraints, boundary commitments, limitations, trade-offs, Implementation Notes
- **Remove**: "How" — testing procedures, deployment steps, detailed implementation code examples

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
   - Should be preserved as-is — it records the original problem, approach, scope, and boundary candidates from discovery
   - No cleanup needed unless content duplicates other files

3. **research.md**:
   - Should contain discovery findings, design decisions, and implementation lessons
   - Check if implementation revealed new constraints or patterns to document
   - Identify content from other files that should be migrated here

4. **requirements.md**:
   - Identify verbose Acceptance Criteria that can be condensed to summaries
   - Find unimplemented requirements (compare with tasks.md)
   - Detect duplicate or redundant content

5. **design.md**:
   - Identify implementation-specific sections that can be removed:
     * Detailed Testing Strategy (test procedures, not the test approach)
     * Security Considerations (if fully addressed in implementation)
     * Error Handling code examples (if implemented)
     * Migration Strategy (after migration complete)
     * Deployment Checklist (after deployment)
   - Identify sections that MUST be preserved:
     * Architecture diagrams and Boundary Commitments
     * Component interfaces and API contracts
     * File Structure Plan (drives task boundaries)
     * Design decisions and rationale
     * Out of Boundary declarations
     * Allowed Dependencies
     * Revalidation Triggers
     * Critical implementation constraints
     * Known limitations

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
- "requirements.md: Simplify Acceptance Criteria from detailed bullet points to summary paragraphs? [Y/n]"
- "requirements.md: Remove unimplemented requirements (e.g., Req 4.4 not implemented)? [Y/n]"
- "design.md: Delete 'Testing Strategy' section (lines X-Y)? [Y/n]"
- "design.md: Keep Boundary Commitments and File Structure Plan (essential for refactoring)? [Y/n]"

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

3. **Simplify requirements.md** (if approved):
   - Transform detailed Acceptance Criteria into summary paragraphs
   - Remove unimplemented requirements entirely
   - Preserve requirement objectives and summaries

4. **Clean up design.md** (if approved):
   - Delete approved implementation-detail sections
   - Preserve: Architecture diagrams, Boundary Commitments, Out of Boundary, Allowed Dependencies, Revalidation Triggers, File Structure Plan, Component interfaces, Design decisions and rationale
   - Integrate salvaged content from other files if relevant

5. **Preserve tasks.md structure**:
   - Keep `## Implementation Notes` intact
   - Keep `_Boundary:_` and `_Depends:_` annotations intact
   - Keep task completion markers as historical record

6. **Preserve brief.md**:
   - No modifications — discovery context is immutable

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
- **brief.md is immutable**: Never modify — it records the original discovery context
- **Language consistency**: All prose content must match `spec.json.language`; code blocks exempt
- **Preserve history**: Don't delete discovery rationale or design decisions
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
