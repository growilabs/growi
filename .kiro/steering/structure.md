# Project Structure

See: `.claude/skills/monorepo-overview/SKILL.md` (auto-loaded by Claude Code)

## cc-sdd Specific Notes

### Server-Client Boundary Enforcement

In full-stack packages (e.g., `apps/app`), server-side code (`src/server/`, models with mongoose) must NOT be imported from client components. This causes module leakage — server-only dependencies get pulled into the client bundle.

- **Pattern**: If a client component needs functionality from a server module, extract the client-safe logic into a shared utility (`src/utils/` or `src/client/util/`)

For apps/app-specific examples and build tooling details, see `apps/app/.claude/skills/build-optimization/SKILL.md`.

---
_Updated: 2026-03-03. apps/app details moved to `apps/app/.claude/skills/build-optimization/SKILL.md`._
