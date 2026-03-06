# Technology Stack

See: `.claude/skills/tech-stack/SKILL.md` (auto-loaded by Claude Code)

## cc-sdd Specific Notes

### Bundler Strategy (Project-Wide Decision)

GROWI uses **Turbopack** (Next.js 16 default) for development. Webpack fallback is available via `USE_WEBPACK=1` environment variable for debugging. Production builds still use `next build --webpack`. All custom webpack loaders/plugins have been migrated to Turbopack equivalents (`turbopack.rules`, `turbopack.resolveAlias`). See `apps/app/.claude/skills/build-optimization/SKILL.md` for details.

### Import Optimization Principles

To prevent module count regression across the monorepo:

- **Subpath imports over barrel imports** — e.g., `import { format } from 'date-fns/format'` instead of `from 'date-fns'`
- **Lightweight replacements** — prefer small single-purpose packages over large multi-feature libraries
- **Server-client boundary** — never import server-only code from client modules; extract client-safe utilities if needed

For apps/app-specific build optimization details (webpack config, null-loader rules, SuperJSON architecture, module count KPI), see `apps/app/.claude/skills/build-optimization/SKILL.md`.

---
_Updated: 2026-03-03. apps/app details moved to `apps/app/.claude/skills/build-optimization/SKILL.md`._
