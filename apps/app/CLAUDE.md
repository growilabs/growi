@AGENTS.md

# apps/app Specific Knowledge

## Critical Architectural Patterns

### Page Save Origin Semantics

**IMPORTANT**: When working on page save, update, or revision operations, always consult the **page-save-origin-semantics** skill (auto-invoked) for understanding the two-stage origin check mechanism.

**Key Concept**: Origin-based conflict detection uses a two-stage check (frontend + backend) to determine when revision validation should be enforced vs. bypassed for Yjs collaborative editing.

**Critical Rule**: **Conflict detection (revision check)** and **other revision-based features (diff detection, history, etc.)** serve different purposes and require separate logic. Do NOT conflate them.

**Quick Reference**:
- Frontend checks `currentPage?.revision?.origin === undefined` to decide if `revisionId` should be sent
- Backend checks `(origin === Editor) && (latestOrigin === Editor || View)` to bypass revision validation
- When `revisionId` is not provided, use server-side fallback: fetch from `currentPage.revision` for non-conflict-detection purposes

**Documentation**:
- Skill (auto-invoked): `.claude/skills/learned/page-save-origin-semantics/SKILL.md`
- Official docs: https://dev.growi.org/651a6f4a008fee2f99187431#origin-%E3%81%AE%E5%BC%B7%E5%BC%B1

**Common Pitfall**: Assuming `revisionId` is always available or forcing frontend to always send it will break Yjs collaborative editing.

