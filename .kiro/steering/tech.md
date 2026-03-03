# Technology Stack

See: `.claude/skills/tech-stack/SKILL.md` (auto-loaded by Claude Code)

## cc-sdd Specific Notes

### Bundler Strategy (Project-Wide Decision)

GROWI uses **Webpack** (not Turbopack) across all Next.js applications. Turbopack is the default in Next.js 16, but GROWI opts out via `--webpack` flag due to custom webpack configuration that Turbopack does not support.

Turbopack migration is deferred as a separate initiative. See `apps/app/.claude/skills/build-optimization/SKILL.md` for details and blockers.

### Import Optimization Principles

To prevent module count regression across the monorepo:

- **Subpath imports over barrel imports** — e.g., `import { format } from 'date-fns/format'` instead of `from 'date-fns'`
- **Lightweight replacements** — prefer small single-purpose packages over large multi-feature libraries
- **Server-client boundary** — never import server-only code from client modules; extract client-safe utilities if needed

For apps/app-specific build optimization details (webpack config, null-loader rules, SuperJSON architecture, module count KPI), see `apps/app/.claude/skills/build-optimization/SKILL.md`.

---
_Updated: 2026-03-03. apps/app details moved to `apps/app/.claude/skills/build-optimization/SKILL.md`._
