@AGENTS.md

# apps/app Specific Knowledge

## Critical Architectural Patterns

### Page Save Origin Semantics

**IMPORTANT**: When working on page save, update, or revision operations, always consult the **page-save-origin-semantics** skill for understanding the two-stage origin check mechanism.

**Key Concept**: Origin-based conflict detection uses a two-stage check (frontend + backend) to determine when revision validation should be enforced vs. bypassed for Yjs collaborative editing.

**Critical Rule**: **Conflict detection (revision check)** and **other revision-based features (diff detection, history, etc.)** serve different purposes and require separate logic. Do NOT conflate them.

**Documentation**:
- Skill (auto-invoked): `.claude/skills/learned/page-save-origin-semantics/SKILL.md`

**Common Pitfall**: Assuming `revisionId` is always available or forcing frontend to always send it will break Yjs collaborative editing.

