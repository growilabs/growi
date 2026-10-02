---
name: learn
description: /learn - Pattern Extraction for GROWI
---

# /learn - Pattern Extraction for GROWI

Extract reusable problem-solving patterns from development sessions and save them as auto-invoked Skills.

## Core Purpose

Capture "non-trivial problems" solved during GROWI development, converting them into reusable skills that will be automatically applied in future sessions.

## Pattern Categories to Extract

Focus on four key areas:

1. **Error Resolution** — Document what went wrong, root causes, and fixes applicable to similar issues (e.g., Mongoose query pitfalls, Next.js hydration errors, TypeScript strict mode issues)

2. **Debugging Techniques** — Capture non-obvious diagnostic steps and tool combinations (e.g., MongoDB query profiling, React DevTools with Jotai, Vitest debugging patterns)

3. **Workarounds** — Record library quirks, API limitations, and version-specific solutions (e.g., @headless-tree edge cases, Socket.io reconnection handling, SWR cache invalidation)

4. **GROWI Patterns** — Note codebase conventions, architecture decisions, and integration approaches (e.g., feature-based structure, Jotai + Socket.io sync, API v3 design patterns)

## Skill File Structure

Extracted patterns are saved in **appropriate skill directories** based on the scope of the pattern:

**Workspace-specific patterns**:
- `apps/{workspace}/.claude/skills/learned/{topic-name}/SKILL.md`
- `packages/{package}/.claude/skills/learned/{topic-name}/SKILL.md`
- Examples: patterns specific to a single app or package

**Global patterns** (monorepo-wide):
- `.claude/skills/learned/{topic-name}/SKILL.md`
- Examples: patterns applicable across all workspaces

### File Template

```yaml
---
name: descriptive-name
description: Brief description (auto-invoked when working on related code)
---

## Problem
[What was the issue]

## Solution
[How it was solved]

## Example
[Code snippet or scenario]

## When to Apply
[Specific conditions where this pattern is useful]
```

## GROWI-Specific Examples

Topics commonly learned in GROWI development:

**Apps/app-specific** (`apps/app/.claude/skills/learned/`):
- `page-save-origin-semantics` — Origin-based conflict detection for collaborative editing
- `socket-jotai-integration` — Real-time state synchronization patterns
- `api-v3-error-handling` — RESTful API error response patterns
- `mongodb-query-optimization` — Mongoose indexing and aggregation patterns

**Global monorepo patterns** (`.claude/skills/learned/`):
- `virtualized-tree-patterns` — @headless-tree + @tanstack/react-virtual optimizations (if used across apps)
- `jotai-atom-composition` — Derived atoms and state composition (if shared pattern)
- `turborepo-cache-invalidation` — Build cache debugging techniques
- `pnpm-workspace-dependencies` — Workspace dependency resolution issues

## Quality Guidelines

**Extract:**
- Patterns that will save time in future sessions
- Non-obvious solutions worth remembering
- Integration techniques between GROWI's tech stack
- Performance optimizations with measurable impact

**Avoid:**
- Trivial fixes (typos, syntax errors)
- One-time issues (service outages, environment-specific problems)
- Information already documented in existing Skills
- Feature-specific details (these stay in code comments)

## Workflow

1. User triggers `/learn` after solving a complex problem
2. Review the session to identify valuable patterns
3. Draft skill file(s) with clear structure
4. **Autonomously determine the appropriate directory**:
   - Analyze the pattern's scope (which files/modules were involved)
   - If pattern is specific to a workspace in `apps/*` or `packages/*`:
     - Save to `{workspace}/.claude/skills/learned/{topic-name}/SKILL.md`
   - If pattern is applicable across multiple workspaces:
     - Save to `.claude/skills/learned/{topic-name}/SKILL.md`
5. Skills automatically apply in future sessions when working on related code

### Directory Selection Logic

**Workspace-specific** (save to `{workspace}/.claude/skills/learned/`):
- Pattern involves workspace-specific concepts, models, or APIs
- References files primarily in one `apps/*` or `packages/*` directory
- Example: Page save logic in `apps/app` → `apps/app/.claude/skills/learned/`

**Global** (save to `.claude/skills/learned/`):
- Pattern applies across multiple workspaces
- Involves monorepo-wide tools (Turborepo, pnpm, Biome, Vitest)
- Shared coding patterns or architectural principles
- Example: Turborepo caching pitfall → `.claude/skills/learned/`

Learned skills are automatically invoked based on their description when working on related code.
