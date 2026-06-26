# Research & Design Decisions

## Summary

- **Feature**: `backlinks`
- **Discovery Scope**: Complex Integration (new server-side index woven into existing page
  lifecycle, permission, rendering, and migration subsystems)
- **Key Findings**:
  - GROWI has **no** links/backlinks infrastructure today; link handling is render-only.
    A new server-side link index (`PageLink`) is required, closely mirroring the
    `PageTagRelation` model precedent.
  - The existing remark/rehype link-resolution plugins (`relative-links`,
    `pukiwiki-like-linker`, `relative-links-by-pukiwiki-like-linker`) are **Node-compatible**
    and already resolve every link form (Markdown, wiki-link, raw HTML `<a>`) against a
    per-page base. Server-side extraction can reuse this exact pipeline, so the index sees
    the same links the renderer does — no second parser to drift.
  - The page lifecycle exposes a ready-made **event bus** (`crowi.events.page`, a Node
    `EventEmitter`). The search service already subscribes to it the way the backlinks index
    will, so no edits to `PageService` are needed.
  - Permission filtering is solved: `Page.findByIdsAndViewer(ids, user, groups)` applies the
    same grant `$or` condition (`generateGrantCondition`) used everywhere else.

## Research Log

### Link extraction — can it run server-side, and what is reusable?

- **Context**: Requirements 1.2–1.4 demand recognizing Markdown, wiki-link, and raw-HTML
  anchors that target internal pages, while excluding external URLs, in-page anchors, and
  links inside code. We must extract these server-side at save time and during backfill.
- **Sources Consulted**:
  - `apps/app/src/services/renderer/rehype-plugins/relative-links.ts:1-65`
  - `apps/app/src/services/renderer/rehype-plugins/relative-links-by-pukiwiki-like-linker.ts:1-30`
  - `apps/app/src/services/renderer/remark-plugins/pukiwiki-like-linker.ts:1-88`
  - `apps/app/src/services/renderer/renderer.tsx:111-181` (`generateCommonOptions`)
  - `packages/core/src/utils/path-utils.ts:113-122` (`normalizePath`)
  - `packages/core/src/utils/page-path-utils/index.ts:119-121` (`isCreatablePage`)
  - `apps/app/src/components/ReactMarkdownComponents/NextLink.tsx:26-35`
- **Findings**:
  - `relativeLinks({ pagePath })` walks `selectAll('a[href]')` over the **HAST** (after
    `rehype-raw` has materialized raw HTML), resolving relative hrefs against `pagePath`.
    Zero DOM/`window` dependencies → runs in Node.
  - The pukiwiki rehype variant resolves wiki-links against a **trailing-slash base** (so
    relative wiki-links resolve as children, not siblings) — matching decision §2.
  - Code spans/blocks never produce `<a>` nodes (they become `<code>`/`<pre>` text), so
    requirement 1.4 is satisfied structurally, not by a special case.
  - `isCreatablePage()` is the same gate `NextLink` uses to decide "internal page vs.
    external/non-page" — the correct §7.2 target-scope filter.
- **Implications**: Extraction is a thin terminal step on the **existing** pipeline. We build
  a server processor from the same plugins, append a collector that harvests resolved `a[href]`
  values into an accumulator, then post-filter (strip `#`/`?` via `new URL(...).pathname`,
  `normalizePath`, `isCreatablePage`, drop self, dedupe). No new parser, no AST mutation.

### Page lifecycle events — how to stay in sync without touching PageService

- **Context**: Requirements 3.1–3.3 and 5–6 require the index to react to create/update/delete.
  Decision §9-A mandates subscribing to the event bus rather than editing `PageService`.
- **Sources Consulted**:
  - `apps/app/src/server/events/page.ts` (PageEvent extends EventEmitter)
  - `apps/app/src/server/crowi/index.ts:248-255` (`this.events.page = new PageEvent(this)`)
  - `apps/app/src/server/service/search.ts:172-239` (existing subscriber precedent)
  - `apps/app/src/server/service/page/index.ts` (emit sites)
- **Findings — confirmed event payloads**:
  | Event | Payload |
  |---|---|
  | `create` | `(page, user)` |
  | `update` | `(page, user)` |
  | `delete` (soft / trash) | `(targetPage, deletedPage, user)` |
  | `deleteCompletely` | `(page, user)` |
  | `syncDescendantsDelete` | `(pages[], user)` — fires in **both** soft and complete descendant flows |
  | `rename` | `()` — no payload, and the main-page rename does not even emit |
- **Implications**:
  - A new `PageLinkService` subscribes in `crowi` setup exactly like `search.ts`.
  - `syncDescendantsDelete` cannot tell soft from complete delete from its payload. This drove
    the **reconcile-by-current-DB-state** decision below.
  - Rename emits nothing usable and needs nothing (see redirect decision).

### Permission filtering — reuse the canonical grant condition

- **Context**: Requirement 2 forbids leaking pages a viewer cannot read.
- **Sources Consulted**: `apps/app/src/server/models/page.ts:526-571` (`addViewerCondition`,
  `addConditionToFilteringByViewer`), `:808-825` (`findByIdsAndViewer`), `:1288-1325`
  (`generateGrantCondition`).
- **Findings**: `findByIdsAndViewer(pageIds, user, userGroups?, includeEmpty?, includeAnyoneWithTheLink?)`
  takes a set of ids and returns only the readable ones, auto-fetching the user's groups. It is
  the exact primitive the backlinks read path needs.
- **Implications**: Backlinks resolve `fromPage` ids → `findByIdsAndViewer` → readable pages.
  Because the filter runs **per request**, grant changes are reflected with no index writes
  (requirement 2.4).

### UI/API conventions

- **Context**: Requirements 1.1, 1.7, 1.8 need a panel and an endpoint.
- **Findings**:
  - apiv3 routes are factory functions `(crowi) => [ ...middleware, handler ]`, registered in
    `routes/apiv3/index.js`; auth via `accessTokenParser([...scopes])` + `loginRequired`;
    user on `req.user`; responses via `res.apiv3(...)` / `res.apiv3Err(...)`.
  - SWR hooks live in `apps/app/src/stores/`, pattern `useSWRImmutable(key, () => apiv3Get(...))`.
  - `PageAccessoriesModal` has a tab map (`PageAccessoriesModalContents`); a new tab plugs in.
  - `PageListItemS` / `PagePathLabel` already render a page's title+path for reuse.
- **Implications**: No new framework patterns; the feature follows established route/hook/panel
  conventions.

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Server-side index via event listener (**chosen**) | Extract links at save, persist `PageLink` edges, react via `crowi.events.page` | Single trust boundary; backfillable; covers every write path; no `PageService` edits | Index lags HTTP response by the async listener window (same as search) | Mirrors `search.ts` precedent |
| Client-side reporting | Browser reports rendered links | Reuses client render | Only runs on view; no backfill; server must re-validate anyway | Rejected (decision §1) |
| Synchronous in-line write inside `PageService` | Write index inside the save transaction | Str+ always current | Couples to `PageService`; violates §9-A; raises save latency | Rejected |
| Derived target-state (no broken/trashed flags stored) (**chosen**) | Store only `toPage` id cache; derive normal/trashed/broken at read from target page status | `_id`-stable cache survives rename & restore with **no** write-time work | Read path must join target status | Resolves §8 trash question |

## Design Decisions

### Decision: `toPage` is an `_id` cache; link target state is **derived**, not stored

- **Context**: Requirements 6.1–6.3 require distinguishing *trashed (recoverable)* from
  *broken (permanently gone)* targets and returning to *normal* on restore. Decision §5
  originally proposed nulling inbound `toPage` on soft-delete and deleting `fromPage` rows.
- **Alternatives Considered**:
  1. Null `toPage` on soft-delete (original §5) — collapses "trashed" into "broken", and
     makes restore require re-resolution + a restore event.
  2. Store an explicit `state` enum column, mutated on every lifecycle event — more writes,
     more event coupling, more drift surface.
  3. **Keep `toPage` pointing at the stable page `_id`; derive state at read time from the
     target page's existence/status.**
- **Selected Approach**: (3). `toPage` is only ever `null` when no page and no redirect chain
  resolves `toPath`. A soft-deleted (trashed) page keeps its `_id`, so inbound `toPage` stays
  valid and the read path reports `trashed` from the target's status; restore needs no write.
  Only **permanent** delete nulls inbound `toPage` → `broken`.
- **Rationale**: GROWI keeps `_id` across rename and trash; deriving state from the live target
  is the minimal model that satisfies requirements 5 and 6 with the fewest write-time hooks.
- **Trade-offs**: Read path must fetch target pages' status (one extra indexed lookup); in
  exchange, rename/move/restore need **zero** index writes.
- **Follow-up**: Confirm `findByIdsAndViewer` does not silently include trashed pages on the
  source side; add an explicit non-trashed filter for backlink *sources*.

### Decision: delete-family handlers **reconcile by current DB state**, not by event semantics

- **Context**: `syncDescendantsDelete` fires for descendants in *both* the soft-delete and the
  permanent-delete flows, with an indistinguishable `(pages[], user)` payload.
- **Selected Approach**: All of `delete`, `deleteCompletely`, `syncDescendantsDelete` route to
  one idempotent `reconcileDeletedPages(pageIds)` that checks each page's **current** state:
  - page still exists (trashed) → no-op (derived state covers it);
  - page truly gone → remove its outbound rows and null inbound `toPage` (→ broken).
- **Rationale**: Robust regardless of which flow emitted the event; idempotent and safe to
  re-run. Listeners run after the operation, so the DB reflects the final state.
- **Trade-offs**: One existence check per affected page; avoids brittle event-type branching.

### Decision: resolve `toPage` through `PageRedirect`; rename needs no write-time work

- **Context**: Requirement 5 (links survive rename/move, including descendants).
- **Selected Approach**: Resolution order — `findByPath(toPath)` first; else follow
  `PageRedirect.retrievePageRedirectEndpoints(toPath).end.toPath` (a `$graphLookup` chain with
  cycle protection); else `null`. Because rename keeps `_id`, existing inbound `toPage` caches
  stay valid; new links to the old path resolve via the redirect chain.
- **Rationale**: Matches what a user clicking the stale link actually experiences; keeps
  `toPath` faithful to the body. `$graphLookup` handles double renames (A→B→C) in one query.
- **Trade-offs**: Redirect records accumulate (`removePageRedirectsByToPath` is unused) — a
  data-hygiene caveat, not a correctness one.

### Decision: requirement 6.4 implies a **forward-link health** read over the same index

- **Context**: 6.4 — when an editor views a page that links to a trashed/deleted target,
  indicate it. This is the *outgoing* direction.
- **Selected Approach**: The `PageLink` table is a directed link graph. Backlinks read reverse
  edges (`toPage = X`); forward-link health reads forward edges (`fromPage = X`) and surfaces
  rows whose derived target state is `trashed`/`broken`. Both reuse the same model, resolution,
  and derived-state logic; the forward view is presented within the Backlinks panel.
- **Rationale**: One index serves both directions; no extra storage. Delivery order of the
  forward-health surface is a backlog concern (requirements doc defers ordering).

### Decision: build vs. adopt — reuse the renderer pipeline, build only the collector

- **Generalization**: Backlinks (reverse) and forward-link health (forward) are the same
  directed-edge query in two directions — modeled once as `PageLink`.
- **Build vs. Adopt**: Adopt the existing remark/rehype link plugins, `normalizePath`,
  `isCreatablePage`, `findByIdsAndViewer`, `PageRedirect`, the event bus, migrate-mongo (indexes
  only), and `CronService` + the page-bulk-export job pattern (backfill). Build only: the
  `PageLink` model, a pure `extractInternalLinks` collector, the resolution helper, the listener
  service, the backfill cron + its job/claim model, one apiv3 route, one SWR hook, and the panel
  components.
- **Simplification**: No queue/worker in v1 (event listener is the seam); no stored state enum;
  no rename/restore hooks; no second Markdown parser.

### Decision: backfill is an online `CronService` job, not a boot-time migrate-mongo migration

- **Context**: Requirement 4 (backfill pre-existing pages). The initial draft put the whole
  backfill in a migrate-mongo migration. Investigation showed two problems for large-plan
  customers (instances with very many pages).
- **Finding 1 — migrate-mongo blocks boot.** GROWI runs migrations synchronously in the Docker
  entrypoint (`docker-entrypoint.ts:247`, `execFileSync`) *before* `spawnApp`, and via the
  `preserver` npm hook (`package.json:17`). A data migration ⇒ the wiki is **offline for the full
  backfill duration**.
- **Finding 2 — per-link resolution is the real cost.** Calling `resolveToPage` per extracted
  link is `findByPath` (+ redirect `$graphLookup`) × millions of links ⇒ potentially hours.
- **Finding 3 — process model.** GROWI is a **single Node process**, no `worker_threads`, no job
  queue, no distributed lock; horizontal scaling = multiple containers on one MongoDB. The
  closest precedent for a heavy background job is the **page-bulk-export job** (extends
  `CronService`, streams pages, persists a progress marker, has a companion in-progress check),
  and the Elasticsearch reindex (streams, GC per batch, admin Socket.IO progress).
- **Selected Approach**:
  1. migrate-mongo creates **only the indexes** (fast, safe to block on at boot).
  2. The heavy backfill is an **online `CronService` job** modeled on page-bulk-export: chunk per
     tick (cadence × chunk = duty cycle = the throttle), resumable via a progress-marker document,
     run-once + multi-instance-safe via an **atomic Mongo claim** (`findOneAndUpdate`), progress
     over the admin Socket.IO channel.
  3. Resolution during backfill uses an **in-memory `{path → _id}` map** built from one projection
     query (hash lookups, not per-link DB round-trips); redirect-following skipped (stragglers
     self-heal on next edit/read).
- **Benchmark anchor** (measured locally on the unified parse pipeline, proxy for extraction):
  ~0.9 ms (0.5 KB) / ~4 ms (3 KB) / ~17 ms (15 KB) / ~87 ms (60 KB) per page; +30–60% for the
  full plugin chain. Central estimate ~5 ms/page. Full-speed totals (also = blocking-downtime if
  it ran at boot): ~1 min/10k, ~10 min/100k, ~50 min/500k, ~1.7 h/1M. Online throttled =
  full-speed ÷ duty cycle (e.g. 25% ⇒ ×4); ×~4 again if pages average ~15 KB.
- **Trade-offs**: backlinks are incomplete for pre-existing pages until the job finishes
  (acceptable per 4.2 — completeness only required *after* completion; new edits index instantly).
  In-process means the parse still shares the one JS thread; the duty cycle bounds but cannot
  remove that contention — only `worker_threads` could, which GROWI lacks (deferred).
- **Follow-up / open**: auto-start vs. admin-triggered is a delivery decision (same job, different
  trigger); verify `CronService` registration site and the bulk-export claim/progress pattern.

## Risks & Mitigations

- **Index lag after save** (listener is async, not awaited) — Mitigation: acceptable for v1
  and identical to search indexing; document the window. Queue/worker deferred.
- **`findByIdsAndViewer` may include trashed pages on the source side** — Mitigation: add an
  explicit non-trashed status filter to the backlink-source query; verify during implementation.
- **Backfill on very large wikis** — Mitigation: online throttled `CronService` job (not a
  boot-blocking migration); in-memory `{path→_id}` resolution; cursor + `createBatchStream` +
  idempotent `bulkWrite` upserts; resumable progress marker; atomic Mongo claim for
  multi-instance. See the backfill decision above.
- **Backfill CPU contention with live traffic** (single JS thread) — Mitigation: duty-cycle
  throttle via cron cadence; conservative default; admin-tunable. Full elimination needs
  `worker_threads` (deferred, no infra).
- **Redirect record accumulation** — Mitigation: none required for correctness (`$graphLookup`
  handles depth); note for future cleanup.
- **Pipeline cost per save** — Mitigation: run a trimmed processor (link plugins only, skip
  sanitize/katex/math) since we only need resolved anchors.

## References

- `apps/app/src/server/models/page-tag-relation.ts` — model precedent (schema/index/statics)
- `apps/app/src/server/service/search.ts:172-239` — event-subscriber precedent
- `apps/app/src/server/models/page.ts:526-571,808-825,1288-1325` — viewer/grant filtering
- `apps/app/src/services/renderer/renderer.tsx:111-181` — shared remark/rehype pipeline
- `apps/app/src/server/models/page-redirect.ts` — `retrievePageRedirectEndpoints` ($graphLookup)
- migrate-mongo refs: `20220131001218-convert-redirect-to-pages-to-page-redirect-documents.js`,
  `20211227060705-revision-path-to-page-id-schema-migration--fixed-8998.js`
- `apps/app/docker/docker-entrypoint.ts:247` — migrations run synchronously at boot (blocking)
- `apps/app/src/server/service/cron.ts` — `CronService` base (node-cron) for background jobs
- `apps/app/src/features/page-bulk-export/server/service/page-bulk-export-job-cron/` — background
  job precedent (CronService + progress marker + in-progress check)
- `apps/app/src/server/service/search-delegator/elasticsearch.ts:602-643` — streaming bulk job
  with admin Socket.IO progress + GC-per-batch
