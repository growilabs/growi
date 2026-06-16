# Roadmap: bulk-export-pdf-rendering → renderer-convergence

> This document describes the multi-phase plan for improving Markdown rendering across GROWI
> surfaces. It lives here because the plan is scoped to bulk-export and the renderer-convergence
> spec that follows it. Project-wide concerns (CJS/ESM constraints, dependency rules) are in
> `.kiro/steering/tech.md`.
>
> Scope, constraints, and boundary candidates for Phase 1 are detailed in [brief.md](./brief.md).

## Overview

**Near-term (Phase 1 — this spec)**: Enrich bulk-export (PDF) server-side rendering by reusing
the plugin knowledge from the web renderer, closing the fidelity gap with the web view within the
current CJS server environment.

**Long-term (Phase 2 — blocked on repo-wide ESM migration)**: Converge bulk-export and web
rendering into a shared pipeline, making GROWI local plugins and full parity available on every
surface.

## Approach Decision

- **Chosen**: Stage the work. Ship the bulk-export rendering improvement now; defer renderer
  convergence to a future spec gated on ESM migration.
- **Why**: The web renderer is stable and serves as a reference, not a change target. Change
  value and risk are concentrated in bulk-export. Code sharing between the two is blocked today
  by the CJS/ESM boundary (confirmed `ERR_REQUIRE_ESM`), making a combined spec premature.
- **Rejected alternatives**:
  - Include the full renderer in one spec → characterisation of a large, stable subsystem adds
    maintenance burden with low change value; real code sharing is impossible today due to
    CJS/ESM incompatibility.
  - Ad-hoc without a roadmap → future convergence intent would be lost.

## Boundary Strategy

- **Why this split**: Phase 1 is a shippable increment that closes within the current runtime.
  Phase 2 is a larger architectural convergence unlocked by ESM migration. Splitting lets each
  spec be reviewed independently and avoids premature spec-ification of stable code.
- **Shared seam to watch**: Plugin selection and ordering between the web renderer
  (`generateCommonOptions`) and the bulk-export renderer. In Phase 1 this is guarded by the
  drift-detection test (Requirement 6); in Phase 2 it graduates to real code sharing.

## Specs (dependency order)

- [~] **bulk-export-pdf-rendering** (this spec) — Enrich bulk-export (PDF) server-side Markdown
  rendering with reused npm ESM plugins + `@growi/core-styles`. Dependencies: none.
  Status: implementation complete, awaiting final review.
- [ ] **renderer-convergence** — Integrate web and bulk-export rendering into a shared pipeline.
  GROWI local plugins reusable server-side; rendering optionally moved to pdf-converter side.
  Dependencies: bulk-export-pdf-rendering, repo-wide ESM migration (`support/esm`).
  Status: future / blocked (brief to be created just-in-time once ESM migration is near).
