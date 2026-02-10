---
description: Organize and clean up specification documents after implementation completion
allowed-tools: Bash, Glob, Grep, Read, Write, Edit, MultiEdit, Update
argument-hint: <feature-name>
---

# Specification Cleanup

<background_information>
- **Mission**: Organize specification documents after implementation completion, removing implementation details while preserving essential context for future refactoring
- **Success Criteria**:
  - Implementation details (testing procedures, deployment checklists) removed
  - Design decisions and constraints preserved in research.md and design.md
  - Requirements simplified (Acceptance Criteria condensed to summaries)
  - Unimplemented features removed or documented
  - Documents remain valuable for future refactoring work
</background_information>

<instructions>
## Core Task
Clean up and organize specification documents for feature **$1** after implementation is complete.

## Organizing Principle

**"Can we read essential context from these spec documents when refactoring this feature months later?"**

- **Keep**: "Why" (design decisions, architectural constraints, limitations, trade-offs)
- **Remove**: "How" (testing procedures, deployment steps, detailed implementation examples)

## Execution Steps

### Step 1: Load Context

**Discover all spec files**:
- Use Glob to find all files in `.kiro/specs/$1/` directory
- Categorize files:
  - **Core files** (must preserve): `spec.json`, `requirements.md`, `design.md`, `tasks.md`, `research.md`
  - **Other files** (evaluate case-by-case): validation reports, notes, prototypes, migration guides, etc.

**Read all discovered files**:
- Read all core files first
- Read other files to understand their content and value

**Verify implementation status**:
- Check that tasks are marked complete `[x]` in tasks.md
- If implementation incomplete, warn user and ask to confirm cleanup

### Step 2: Analyze Current State

**Identify cleanup opportunities**:

1. **Other files** (non-core files like validation-report.md, notes.md, etc.):
   - Read each file to understand its content and purpose
   - Identify valuable information that should be preserved:
     * Implementation discoveries and lessons learned
     * Critical constraints or design decisions
     * Historical context for future refactoring
   - Determine salvage strategy:
     * Migrate valuable content to research.md or design.md
     * Keep file if it contains essential reference information
     * Delete if content is redundant or no longer relevant
   - **Case-by-case evaluation required** - never assume files should be deleted

2. **research.md**:
   - Should contain production discoveries and implementation lessons learned
   - Check if implementation revealed new constraints or patterns to document
   - Identify content from other files that should be migrated here

3. **requirements.md**:
   - Identify verbose Acceptance Criteria that can be condensed to summaries
   - Find unimplemented requirements (compare with tasks.md)
   - Detect duplicate or redundant content

4. **design.md**:
   - Identify implementation-specific sections that can be removed:
     * Detailed Testing Strategy (test procedures)
     * Security Considerations (if covered in implementation)
     * Error Handling code examples (if implemented)
     * Migration Strategy (after migration complete)
     * Deployment Checklist (after deployment)
   - Identify sections to preserve:
     * Architecture diagrams (essential for understanding)
     * Component interfaces (API contracts)
     * Design decisions and rationale
     * Critical implementation constraints
     * Known limitations
   - Check if content from other files should be migrated here

### Step 3: Interactive Confirmation

**Present cleanup plan to user**:

For each file and section identified in Step 2, ask:
- "Should I delete/simplify/keep/salvage this section?"
- Provide recommendations based on organizing principle
- Show brief preview of content to aid decision

**Example questions for other files**:
- "validation-report.md found. Contains {brief summary}. Options:"
  - "A: Migrate valuable content to research.md, then delete"
  - "B: Keep as historical reference"
  - "C: Delete (content no longer needed)"
- "notes.md found. Contains {brief summary}. Salvage to research.md before deleting? [Y/n]"

**Example questions for core files**:
- "research.md: Add 'Session N: Production Discoveries' section to document implementation lessons? [Y/n]"
- "requirements.md: Simplify Acceptance Criteria from detailed bullet points to summary paragraphs? [Y/n]"
- "requirements.md: Remove unimplemented requirements (e.g., Req 4.4 field masking not implemented)? [Y/n]"
- "design.md: Delete 'Testing Strategy' section (lines X-Y)? [Y/n]"
- "design.md: Delete 'Security Considerations' section (lines X-Y)? [Y/n]"
- "design.md: Keep Architecture diagrams (essential for refactoring)? [Y/n]"

**Batch similar decisions**:
- Group related sections (e.g., all "delete implementation details" decisions)
- Allow user to approve categories rather than individual items
- Present file-by-file salvage decisions for other files

### Step 4: Execute Cleanup

**For each approved action**:

1. **Salvage and cleanup other files** (if approved):
   - For each non-core file (validation-report.md, notes.md, etc.):
     * Extract valuable information (implementation lessons, constraints, decisions)
     * Migrate content to appropriate core file:
       - Technical discoveries → research.md
       - Design constraints → design.md
       - Requirement clarifications → requirements.md
     * Delete file after salvage (if approved)
   - Document salvaged content with source reference (e.g., "From validation-report.md:")

2. **Update research.md** (if new discoveries or salvaged content):
   - Add new section "Session N: Production Implementation Discoveries" (if needed)
   - Document critical technical constraints discovered during implementation
   - Include code examples for critical patterns (e.g., falsy checks, credential preservation)
   - Integrate salvaged content from other files
   - Cross-reference requirements.md and design.md where relevant

3. **Simplify requirements.md** (if approved):
   - Transform detailed Acceptance Criteria into summary paragraphs
   - Remove unimplemented requirements entirely
   - Preserve requirement objectives and summaries
   - Example transformation:
     ```
     Before: "1. System shall X... 2. System shall Y... [7 criteria]"
     After: "**Summary**: System provides X and Y. Configuration includes..."
     ```

4. **Clean up design.md** (if approved):
   - Delete approved sections (Testing Strategy, Security Considerations, etc.)
   - Add "Critical Implementation Constraints" section if implementation revealed new constraints
   - Integrate salvaged content from other files (if relevant)
   - Preserve architecture diagrams and component interfaces
   - Keep design decisions and rationale sections

5. **Update spec.json metadata**:
   - Set `phase: "implementation-complete"` (if not already set)
   - Add `cleanup_completed: true` flag
   - Update `updated_at` timestamp

### Step 5: Generate Cleanup Summary

**Provide summary report**:
- List of files modified/deleted
- Sections removed and lines saved
- Critical information preserved
- Recommendations for future refactoring

**Format**:
```markdown
## Cleanup Summary for {feature-name}

### Files Modified
- ✅ validation-report.md: Salvaged to research.md, then deleted (730 lines removed)
- ✅ notes.md: Salvaged to design.md, then deleted (120 lines removed)
- ✅ research.md: Added Session 2 discoveries + salvaged content (180 lines added)
- ✅ requirements.md: Simplified 6 requirements (350 lines → 180 lines)
- ✅ design.md: Removed 4 sections, added constraints + salvaged content (250 lines removed, 100 added)

### Information Salvaged
- Implementation discoveries from validation-report.md → research.md
- Design notes from notes.md → design.md
- Historical context preserved with source attribution

### Information Preserved
- Architecture diagrams and component interfaces
- Design decisions and rationale
- Critical implementation constraints
- Known limitations and trade-offs

### Next Steps
- Spec documents ready for future refactoring reference
- Consider creating knowledge base entry if pattern is reusable
```

## Critical Constraints

- **User approval required**: Never delete content without explicit confirmation
- **Language consistency**: Use language specified in spec.json for all updates
- **Preserve history**: Don't delete discovery rationale or design decisions
- **Balance brevity with completeness**: Remove redundancy but keep essential context
- **Interactive workflow**: Pause for user input rather than making assumptions

## Tool Guidance

- **Glob**: Discover all files in `.kiro/specs/{feature}/` directory
- **Read**: Load all discovered files for analysis
- **Grep**: Search for patterns (e.g., unimplemented requirements, completed tasks)
- **Edit/Write**: Update files based on approved changes, salvage content
- **Bash**: Delete files after salvage (if approved)
- **MultiEdit**: For batch edits across multiple sections

## Output Description

Provide cleanup plan and execution report in the language specified in spec.json.

**Report Structure**:
1. **Current State Analysis**: What needs cleanup and why
2. **Cleanup Plan**: Proposed changes with recommendations
3. **Confirmation Prompts**: Interactive questions for user approval
4. **Execution Summary**: What was changed and why
5. **Preserved Context**: What critical information remains for future refactoring

**Format**: Clear, scannable format with sections and bullet points

## Safety & Fallback

### Error Scenarios

**Implementation Incomplete**:
- **Condition**: Less than 90% of tasks marked `[x]` in tasks.md
- **Action**: Warn user: "Implementation appears incomplete (X/Y tasks done). Continue cleanup? [y/N]"
- **Recommendation**: Wait until implementation complete before cleanup

**Spec Not Found**:
- **Message**: "No spec found for `$1`. Check available specs in `.kiro/specs/`"
- **Action**: List available spec directories

**Missing Critical Files**:
- **Condition**: requirements.md or design.md missing
- **Action**: Skip cleanup for missing files, proceed with available files
- **Warning**: "requirements.md missing - cannot simplify requirements"

### Dry Run Mode (Future Enhancement)

**If `-n` or `--dry-run` flag provided**:
- Show cleanup plan without executing changes
- Allow user to review before committing to cleanup

### Backup Recommendation

**Before cleanup**:
- Recommend user create git commit or backup
- Warning: "This will modify spec files. Commit current state first? [Y/n]"

### Undo Support

**If cleanup goes wrong**:
- Use git to restore previous state: `git checkout HEAD -- .kiro/specs/{feature}/`
- Remind user to commit before cleanup for easy rollback

## Example Usage

```bash
# Basic cleanup after implementation
/kiro:spec-cleanup oauth2-email-support

# With conversation context about implementation discoveries
# Command will prompt for Session N discoveries to document
/kiro:spec-cleanup user-authentication
```

## Related Commands

- `/kiro:spec-impl {feature}` - Implement tasks (run before cleanup)
- `/kiro:validate-impl {feature}` - Validate implementation (run before cleanup)
- `/kiro:spec-status {feature}` - Check implementation status
