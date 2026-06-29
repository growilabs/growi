# Project Structure

The monorepo layout (apps/packages, `@growi/core` role, build order, Changeset workflow) is in `.claude/rules/project-structure.md` (always loaded). This file records cc-sdd-specific structural notes.

## cc-sdd Specific Notes

### Server-Client Boundary Enforcement

In full-stack packages (e.g., `apps/app`), server-side code (`src/server/`, models with mongoose) must NOT be imported from client components. This causes module leakage — server-only dependencies get pulled into the client bundle.

- **Pattern**: If a client component needs functionality from a server module, extract the client-safe logic into a shared utility (`src/utils/` or `src/client/util/`)

For apps/app-specific examples and build tooling details, see `apps/app/.claude/skills/build-optimization/SKILL.md`.

### The positioning of @growi/core.

See: `.claude/rules/project-structure.md` — "@growi/core — Shared Domain Hub" section (always loaded).

---
_Updated: 2026-06-16. Repointed broken monorepo-overview SKILL.md references to `.claude/rules/project-structure.md` (the skill no longer exists; esm-migration Phase 5.5)._
