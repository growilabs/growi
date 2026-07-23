# Implementation Plan

> **Organized by story, not by architectural layer.** The five stories (B1–B5) are vertical,
> shippable slices; this plan is sequenced so each story is a **contiguous block** you can build and
> verify end-to-end before starting the next — no skipping around. B1 carries the shared foundation
> (model, indexes, extractor, service, read path, panel) because the first vertical slice always
> carries the walking skeleton; B2–B5 graft onto it.
>
> **Where a capability was split across stories**, the task notes call it out explicitly:
> `resolveToPage`, the sync ops, the lifecycle handlers, the read queries, `BacklinkListItem`,
> `BacklinksPanel`, and the event subscription each get their B1 half here and their B4/B5 half in
> the later story.
>
> **Manual-implementation guide.** This plan is written to be worked by hand as a checklist (not via
> `/kiro-impl`). Each task states what to build, a **Done when** acceptance line, the requirements it
> satisfies, the **Boundary** (the symbol/module it lands in — see design.md § File Structure Plan),
> and its dependencies. Tasks with no dependency between them can be done in any order.
>
> **Story independence:** B2 (scale — read-path perf + write-path burst control), B3 (backfill),
> B4 (rename/move), and B5 (delete/broken) are all independent of one another — each depends only on
> B1. Do them in whatever order you like after B1.

---

## Story B1 — See which pages link here (all link forms, permission-filtered)

**Nature:** Foundation. Introduces the `PageLink` collection, the extractor, the live create/edit
sync, the permission-filtered read, the API, and the panel. All five link forms (Markdown, wiki-link,
raw HTML anchor, permalink `/{id}`, same-host absolute URL) ship together — the design builds
extraction and resolution for all of them as one unit; there is no separable "naive query" or
"wiki-links later" stage. Lifecycle coverage is **create/update only**.

- [x] B1.1 Define backlinks interfaces and shared types
  - Define the `IPageLink` edge shape (`fromPage`, `toPath`, `toPage`), the two client DTOs —
    `IBacklink` (page id + path; incoming backlinks, always healthy) and `ILinkTarget` (page id +
    path + required target state; outgoing link health) — and the `LinkTargetState` union
    (`normal` / `trashed` / `broken`)
  - Define `ILinkTarget` and the full union now even though outgoing health (`trashed`/`broken`)
    isn't produced until B5 — declaring them up front is harmless and avoids a later type change
  - Done when the types compile and are importable by both server and client code
  - _Requirements: 1.8, 6.4_

- [x] B1.2 Implement the PageLink model with indexes and the B1 statics
  - Create the Mongoose model following the `PageTagRelation` precedent (`getOrCreateModel`)
  - Declare indexes `{fromPage}`, `{toPath}`, `{toPage}` and the **unique** `{fromPage, toPath}`
    index that enforces "one source listed once"
  - `PageLink` is a **new** collection, so the four indexes are created from these schema
    declarations by Mongoose `autoIndex` at model registration — no migrate-mongo migration is
    needed (same as the `PageTagRelation` precedent, whose unique compound index is schema-declared
    with no migration). A migration would only be required to *drop/alter* an index later.
  - Implement the two statics B1 needs: replace-outbound and find-backlink-sources. You may declare
    the typed signatures for re-resolve-by-path (implemented in B4) and reconcile-deleted
    (implemented in B5) now, but do not implement them here
  - Done when the model registers, its indexes exist, and a unit test confirms the unique index
    rejects a duplicate `{fromPage, toPath}` insert
  - _Requirements: 1.5, 3.4_
  - _Depends: B1.1_

- [x] B1.3 Implement internal-link extraction from a page body — all link forms
  - Build a pure function that takes a Markdown body, the page's path, and the wiki's site URL, and
    returns a deduplicated list of resolved internal page paths, reusing the existing remark/rehype
    link plugins (pukiwiki + relative-links) in a trimmed server processor
  - Recognize standard Markdown, wiki-link (`[[alias>/path]]`), and raw-HTML anchors; classify
    scheme-bearing absolute URLs by host (same host as the configured site URL → keep its path
    component; different host → external; site URL unset → no absolute URL is internal); exclude
    in-page `#` anchors and links inside code spans/blocks; strip query/anchor; normalize paths;
    gate on `isCreatablePage`; pass page-permalink (`/{id}`) targets through unchanged; drop the
    page's own-**path** self-link only (a link to the page's own permalink cannot be detected here —
    the extractor has no page `_id` — and is dropped later at sync, task B1.5)
  - Done when unit tests cover each link form and each exclusion rule, plus a same-host absolute URL
    kept as its path, a different-host URL and a (site-URL-unset) absolute URL both excluded, and a
    permalink returned verbatim; the deduped result excludes the page's own-path self-link
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.9, 1.10, 1.11_
  - _Boundary: extractInternalLinks_
  - _Depends: B1.1 (independent of B1.2)_

- [x] B1.4 Implement target-page resolution — direct path + permalink only
  - Build the live-path resolver: a **permalink** path (`/{id}`) resolves directly to that page id
    with no path lookup or redirect-following; otherwise a path resolves by direct path lookup, else
    null. A permalink to a non-existent id also resolves to null
  - **B1 scope: no redirect-chain following.** Following the redirect chain to its endpoint (for
    renamed/moved targets, multi-hop A→B→C) is deferred to **B4.1**. In B1, a link to a page that has
    since moved resolves to null until B4 is built — acceptable for the create/update-only slice
  - Done when unit tests cover a direct path hit, a permalink resolving by id, and both null cases
    (no page at path; no page with that id)
  - _Requirements: 1.9_
  - _Boundary: resolveToPage_
  - _Depends: B1.1 (independent of B1.2, B1.3)_

- [x] B1.5 Implement the index synchronization operations — replace-outbound + self-drop only
  - Implement the row operation on top of the model: replace a source page's outbound rows from a
    freshly extracted+resolved set, **dropping any resolved row whose target is the source page
    itself** (covers a page linking to its own permalink, and any alias that resolves back to the
    source — the self-permalink half of 1.6)
  - **B1 scope:** skip reconcile-deleted (B5.2) and re-resolve-by-path (B4.2)
  - Done when unit tests show replacing outbound rows is idempotent and excludes a self-permalink row
  - _Requirements: 1.6, 3.1, 3.2_
  - _Boundary: page-link-sync, PageLink_
  - _Depends: B1.2, B1.3, B1.4_

- [x] B1.6 Implement the create/update lifecycle handlers in the backlinks service
  - Implement the service handlers for create and update: re-extract the body and replace the source
    page's outbound rows via B1.5. The service reads the configured site URL and passes it into
    extraction (so same-wiki absolute URLs are recognized), keeping the extractor itself config-free.
    Read the body from the latest revision when the event payload lacks it
  - Handlers are idempotent and tolerate missing/empty bodies
  - **B1 scope:** create does **not** re-resolve inbound matches here — repointing stale caches when
    a page appears at a previously-occupied path is deferred to **B4.3**. Skip the delete-family
    handlers (B5.3)
  - Done when unit tests invoke the create and update handlers with a fake event payload and assert
    the resulting row changes (created/replaced), including a same-wiki absolute link recorded as an
    internal row
  - _Requirements: 1.10, 1.11, 3.1, 3.2_
  - _Boundary: PageLinkService_
  - _Depends: B1.5_

- [x] B1.7 Implement the permission-filtered read query — findBacklinks only
  - Implement `findBacklinks` (sources pointing at a page, filtered to readable, non-trashed pages
    via the shared viewer/grant filter, mapped to `IBacklink`)
  - Never return unfiltered paths; any count is derived only from the filtered set
  - **B1 scope:** skip `findForwardLinkHealth` (B5.4)
  - Done when integration tests show restricted source pages are omitted from results, and the query
    returns the readable, non-trashed sources as `IBacklink` DTOs
  - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4_
  - _Boundary: PageLinkService_
  - _Depends: B1.2_

- [x] B1.8 Add the backlinks read endpoint
  - Add an authenticated apiv3 GET route that validates a page id, resolves the viewer from the
    request, and returns the permission-filtered backlinks for that page
  - Done when the endpoint returns backlinks for a readable page and 400/403 for invalid id /
    no-access, delegating filtering to the service
  - _Requirements: 1.1, 2.1, 6.4_
  - _Boundary: get-page-backlinks route_
  - _Depends: B1.7_

- [ ] B1.9 Add the client data hook
  - Add an SWR hook keyed by page id (and guest state) that fetches from the backlinks endpoint and
    returns the backlink list
  - Done when the hook returns data for a page and revalidates when the page id changes
  - _Requirements: 1.1_
  - _Boundary: useSWRxBacklinks_
  - _Depends: B1.8_

- [ ] B1.10 Build the backlink list-item component — title + path only
  - Build a presentational row showing a linked page's title and path (reusing existing page-path
    label components)
  - **B1 scope:** skip the trashed/broken target-state badge (B5.5)
  - Done when the component renders title + path for a normal link
  - _Requirements: 1.8_
  - _Boundary: BacklinkListItem_
  - _Depends: B1.1_

- [ ] B1.11 Build the backlinks panel — incoming list + empty state
  - Build the panel that lists incoming links via the hook and renders an explicit empty state when
    there are none
  - **B1 scope:** skip the secondary "outgoing links needing attention" forward-health section (B5.6)
  - Done when the panel shows the backlink list and the empty state when there are no backlinks
  - _Requirements: 1.1, 1.7, 1.8_
  - _Boundary: BacklinksPanel_
  - _Depends: B1.9, B1.10_

- [x] B1.12 Subscribe the service to create/update lifecycle events
  - Instantiate and initialize the backlinks service in the server setup phase (mirroring the search
    service), subscribing its handlers to create/update only; do not modify the page service
  - **B1 scope:** skip the delete-family subscriptions (delete/deleteCompletely/
    syncDescendantsDelete) — B5.7
  - Done when creating and editing a page through the app changes `PageLink` rows accordingly
    (verified by B1.15's lifecycle integration test)
  - _Requirements: 3.1, 3.2_
  - _Boundary: crowi setup, PageLinkService_
  - _Depends: B1.6_

- [x] B1.13 Register the backlinks endpoint
  - Register the read route in the apiv3 router
  - Done when the endpoint is reachable over HTTP and returns backlinks for a seeded page
  - _Requirements: 1.1_
  - _Boundary: apiv3 router_
  - _Depends: B1.8 (independent of B1.12)_

- [ ] B1.14 Add the Backlinks tab to the page accessories UI
  - Add a Backlinks entry to the page-accessories tab mapping that renders the panel
  - Done when opening the tab on a page displays the backlinks panel
  - _Requirements: 1.1_
  - _Boundary: PageAccessoriesModal_
  - _Depends: B1.11_

- [x] B1.15 Integration tests (B1 slice)
  - Cover: create/update add and remove backlinks; backlinks exclude pages the viewer cannot read and
    reflect grant changes; a source linking B→A more than once is listed once; a page linking to its
    own permalink is excluded from its own backlinks
  - **B1 scope:** skip rename/move (B4.4) and trash/delete/restore (B5.8) scenarios
  - Done when these scenarios pass against the wired service through real create/update lifecycle calls
  - _Requirements: 1.6, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2_
  - _Depends: B1.12, B1.13_

- [ ] B1.16 E2E test for the backlinks panel (B1 slice)
  - Verify the Backlinks tab lists linking pages with title + path, and shows the empty state when
    none exist
  - **B1 scope:** skip trashed/deleted-target-indicator assertions (B5.8)
  - Done when the E2E flow passes for the populated and empty cases
  - _Requirements: 1.1, 1.7, 1.8_
  - _Depends: B1.14_

---

## Story B2 — Backlinks at scale (read-path perf + write-path burst control)

**Nature:** Two independent slices cleaved along the read/write seam, each depending only on B1:
**B2.1** is a read-path validation — a pure benchmark proving the `{toPage}` index and viewer filter
return backlinks in interactive time on a static ~100k-page dataset (no production code change
expected). **B2.2** is a write-path production change — grafting an in-process coalescing + pacing
queue onto the B1 walking-skeleton listener so bursts of saves don't storm MongoDB or block live
reads. Read-side query latency is independent of write pacing, so the two share no dependency.

**Recommended sequence: B2.2 before B2.1.** B2.2 ships real production behavior that protects the
write path today; B2.1 is a read-only benchmark on static data that can run at any time and mainly
confirms B1's index choice. (Not a hard dependency — either order is correct.)

- [ ] B2.1 Performance check for backlinks retrieval at scale (read-path)
  - A measurement exercise, not a feature build: prove Req 3.4's target and locate any bottleneck
    while it is still a cheap, pre-merge index fix. Pure read benchmark on a statically seeded
    dataset — independent of B2.2's write pacing.
  - **Seed** ~100k pages with realistic internal linking, deliberately including a **heavily-linked
    hub page** (thousands of inbound sources) — the worst case for the read path and the page you
    actually measure. Use a throwaway/fixture seeding script, **not** the B3 backfill job.
  - **Confirm the indexes exist** on the seeded collection (created by B1.2 `autoIndex`) — a check,
    not new work: `{toPage}` in particular.
  - **Measure the real read path** for the hub page **as a viewer**: the full `findBacklinks` →
    `findBacklinkSources` (`distinct` on `{toPage}`) → permission/viewer filter path, not the raw
    Mongo query alone. Confirm it returns in interactive time (<~1s).
  - **Inspect the query plan** (`explain()`) on the `distinct` and the viewer-filter query to confirm
    they use an index rather than collection-scanning — this is what tells you *why* the number is
    what it is, and *where* to fix it if it is slow.
  - **Confirm the no-rescan guarantee** by inspection/a targeted check: a single create/edit rewrites
    only that page's rows (the `replaceOutboundLinks` bulkWrite) and never walks all pages.
  - If the target is missed, the `explain()` output points at the fix (usually a missing/compound
    index or a filter restructure); that fix — an index/query change only — is then part of this task.
  - **Decision to make before starting:** keep this as a permanent CI integ test, or run it as a
    one-off/manual (or separately-gated) benchmark? Seeding 100k pages on every CI run is expensive,
    so it is usually run manually with the result recorded rather than left in the normal test suite.
    This changes how the measurement step is written (timed integ test vs. standalone script).
  - Done when a measured retrieval against the ~100k-page dataset meets the <~1s target, the
    `explain()` evidence shows the query is index-backed, and the no-rescan guarantee is confirmed
    (plus any surfaced index/query fix is applied)
  - _Requirements: 3.4_
  - _Depends: B1.12, B1.13_

- [ ] B2.2 Coalesce and pace live extraction (write-path burst control)
  - Replace the B1.6/B1.12 inline per-event extraction with an in-process coalescing queue: the
    `create`/`update` handlers mark the page dirty (`Set<pageId>`); a paced tick drains a bounded
    number of ids per cycle, re-reads each page's latest body at drain time, and runs the existing
    upsert handler once per page. `handlePageUpsert` stays the per-page unit — the queue is the seam.
  - A `delete`-family event removes the id from the dirty set and routes to `reconcileDeletedPages`
    (delete supersedes a pending upsert), so a stale upsert never re-creates rows for a gone page.
  - Best-effort/in-memory by design: a restart drops pending work (self-heals on next edit/backfill);
    the set is per-instance in multi-container deployments (safe because upserts are idempotent).
  - **Why (MongoDB impact):** every save runs `PageLink.replaceOutboundLinks`, a single `bulkWrite`
    that upserts one row per extracted link and issues a `deleteMany` for links no longer present —
    each component write maintaining all four `pagelinks` indexes (`{fromPage}`, `{toPath}`,
    `{toPage}`, unique `{fromPage, toPath}`). Without coalescing, N rapid saves of one page = N full
    `bulkWrite` replaces of which N−1 are immediately obsolete, yet each still re-upserts every row,
    re-scans for the `deleteMany`, rewrites all four index B-trees, and (under the `rs0` replica set)
    emits oplog entries that replicate to secondaries. A burst across distinct pages runs these
    `bulkWrite`s concurrently, contending for write tickets and collection locks with the
    latency-sensitive backlinks read (`findBacklinkSources`, a `distinct` on `{toPage}`) — so the
    write storm is what actually slows reader queries at the storage-engine level. Coalescing
    collapses same-page saves to **one** `bulkWrite` reflecting only the final link set (safe because
    `replaceOutboundLinks` is idempotent), cutting write volume, index maintenance, and oplog/
    replication traffic from N to 1; pacing then caps distinct-page `bulkWrite`s per tick, converting
    an unbounded write spike into steady, bounded write QPS that coexists with reads. Delete must
    supersede a pending upsert because the upsert path uses `upsert: true` — running a stale upsert
    for a since-deleted page would re-create `pagelinks` rows for a non-existent source (orphan rows
    a reader could surface as phantom backlinks).
  - Done when: repeated saves of the same page within the tick window produce exactly one extraction
    / one `replaceOutboundLinks` `bulkWrite` (asserted via a spy/count on the upsert handler); a burst
    of distinct-page saves is drained over multiple ticks rather than in one synchronous spree; a
    delete during a pending upsert results in reconcile, not a re-created row.
  - _Requirements: 3.5_
  - _Boundary: PageLinkService_
  - _Depends: B1.6, B1.12_

---

## Story B3 — Backfill of pre-existing pages

**Nature:** Online, throttled, resumable, auto-started `CronService` job that populates rows for pages
that existed before the feature. Reuses the page-bulk-export scaffolding (`CronService` base,
`createBatchStream`, cursor→resume→`pipeline` skeleton, watchdog start/stop) and the B1 extractor; the
new code is the in-memory `{path→_id}` map, the `bulkWrite` upsert sink, and the atomic claim. An
admin-triggered start was deferred as a one-line future change. Independent of B4/B5.

- [ ] B3.1 Add the backfill job state model
  - Add a single-document model tracking backfill status, a progress marker (resume point), and an
    atomic-claim field so only one instance runs the job and it stops once complete
  - Done when a unit test shows the claim succeeds once and is rejected for a second concurrent claimant
  - _Requirements: 4.3_
  - _Boundary: PageLinkBackfillJob_
  - _Depends: B1.2_

- [ ] B3.2 Implement the throttled, resumable backfill job
  - Implement a cron-based job that, per tick, processes a bounded chunk of pages: build/reuse an
    in-memory path→id map (one projection query) for resolution instead of per-link lookups, extract
    links via the B1 extractor (passing the configured site URL), resolve permalink targets via an
    id-existence check against the known page ids (not the path map), and bulk-upsert rows; persist
    the progress marker after each chunk and resume from it on restart
  - Throttle via cron cadence × chunk size; skip immediately once the job document is complete
  - Done when running the job over a seeded dataset (including pages linked by permalink and by
    same-wiki absolute URL) populates rows equivalent to the live path, a re-run/resume adds no
    duplicates, and progress is emitted on the admin channel
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: PageLinkBackfillCron_
  - _Depends: B3.1, B1.3, B1.2_

- [ ] B3.3 Register and auto-start the backfill job
  - Register the backfill cron in server setup and auto-start it (throttled) after boot, mirroring
    the page-bulk-export watchdog start/stop; stop permanently once the job document is marked complete
  - Note: edits the same server-setup file as B1.12 — sequence after it to avoid a merge
  - Done when, after boot, the job claims and runs to completion on a fresh dataset and marks itself
    complete so it does not re-run
  - _Requirements: 4.1_
  - _Boundary: crowi setup, PageLinkBackfillCron_
  - _Depends: B3.2, B1.12_

- [ ] B3.4 Backfill tests
  - Verify backfill output matches the live path; running twice or resuming after an interrupted chunk
    produces no duplicates; the atomic claim prevents two instances/ticks double-processing
  - Done when these pass against a seeded dataset
  - _Requirements: 4.1, 4.2, 4.3_
  - _Depends: B3.2_

---

## Story B4 — Link integrity across rename / move

**Nature:** Extends resolution so inbound links survive a target's rename/move. Rename/move emit no
usable event and need none: `_id`-stable `toPage` keeps links cached before the move valid, and
redirect-following keeps links resolvable when the source is re-saved after the move. This story adds
the redirect-following half of resolution plus the re-resolve-by-path repointing. Independent of
B3/B5.

- [ ] B4.1 Add redirect-chain following to resolveToPage
  - Extend the resolver with the redirect step deferred from B1.4: when direct path lookup misses,
    follow the redirect chain to its endpoint and resolve there; handle multi-hop renames (A→B→C) via
    the redirect endpoint lookup; null when neither a page nor a redirect resolves (the broken case).
    A permalink `toPath` still short-circuits by id (never needs redirect-following — 5.4)
  - Done when unit tests cover single and double redirect chains resolving to the endpoint, and the
    unresolved (null) case
  - _Requirements: 1.9, 5.1, 5.2, 5.3, 5.4_
  - _Boundary: resolveToPage_
  - _Depends: B1.4_

- [ ] B4.2 Implement the re-resolve-by-path sync operation
  - Implement the row op deferred from B1.5: re-resolve inbound rows matching a given path (to repoint
    stale caches when a page appears at that path)
  - Done when a unit test shows inbound rows for a path get their `toPage` repointed when a page
    resolves at that path
  - _Requirements: 5.1, 5.2_
  - _Boundary: page-link-sync, PageLink_
  - _Depends: B1.2, B4.1_

- [ ] B4.3 Wire re-resolve into the create handler
  - Extend the B1.6 create handler to re-resolve inbound matches (`reResolveByToPath(page.path)`)
    after replacing outbound rows, so links that previously pointed at this path (from a prior
    occupant or a broken state) are corrected when the page is (re)created at it
  - Done when a unit test shows creating a page at a path repoints inbound rows that referenced that path
  - _Requirements: 5.1, 5.2_
  - _Boundary: PageLinkService_
  - _Depends: B4.2, B1.6_

- [ ] B4.4 Integration tests (rename/move)
  - Cover: inbound links survive a target's rename/move (including descendant moves) with **no index
    writes** — resolution + `_id`-stable cache keep them valid; a permalink-based backlink keeps
    resolving after its target is renamed/moved with no index writes (5.4)
  - Done when these scenarios pass against the wired service through real rename/move operations
  - _Requirements: 1.9, 5.1, 5.2, 5.4_
  - _Depends: B4.3, B1.12_

---

## Story B5 — Broken / trashed link handling on deletion

**Nature:** Adds the delete-family reconcile, the derived target-state (`trashed`/`broken`), the
forward-link-health read, and the UI that surfaces it. Restore needs no write — derived state reads
the restored page's status. Independent of B3/B4.

- [ ] B5.1 Add the reconcile static and target-state derivation
  - Implement the reconcile-deleted static on the model (signature declared in B1.2) and the
    `LinkTargetState` derivation helper (`toPage == null` → `broken`; target trashed → `trashed`; else
    `normal`) — state is derived, never stored
  - Done when unit tests cover the three derived states from `toPage`/target status
  - _Requirements: 6.1, 6.2, 6.3_
  - _Boundary: PageLink, page-link-sync_
  - _Depends: B1.2_

- [ ] B5.2 Implement the reconcile-deleted sync operation
  - Implement the reconcile op deferred from B1.5: reconcile a deleted page by checking its current DB
    state — still trashed → no-op (derived state shows trashed); truly gone → remove its outbound rows
    and null inbound `toPage` (broken)
  - Done when unit tests show reconcile no-ops a trashed page and nulls inbound `toPage` for a
    permanently-gone page
  - _Requirements: 3.3, 6.1, 6.2_
  - _Boundary: page-link-sync_
  - _Depends: B5.1_

- [ ] B5.3 Implement the delete-family lifecycle handlers
  - Implement the service handlers deferred from B1.6: delete/deleteCompletely/syncDescendantsDelete
    all route to the state-based reconcile. Idempotent; tolerate already-removed pages
  - Done when unit tests invoke each handler with a fake event payload and assert the resulting row
    changes (removed/nulled)
  - _Requirements: 3.3, 6.1, 6.2_
  - _Boundary: PageLinkService_
  - _Depends: B5.2, B1.6_

- [ ] B5.4 Implement the forward-link-health read query
  - Implement `findForwardLinkHealth` (a page's outbound rows whose derived target state is
    trashed/broken, mapped to `ILinkTarget`); derive target state from `toPage`/target status rather
    than a stored flag
  - Done when an integration test shows forward health reports trashed/broken targets with the correct
    state
  - _Requirements: 5.3, 6.1, 6.2, 6.3, 6.4_
  - _Boundary: PageLinkService_
  - _Depends: B5.1, B1.7_

- [ ] B5.5 Add the target-state badge to the list-item
  - Extend `BacklinkListItem` (from B1.10) with a trashed/broken target-state badge
  - Done when the component shows the badge for trashed/broken targets and renders unchanged for normal ones
  - _Requirements: 6.4_
  - _Boundary: BacklinkListItem_
  - _Depends: B1.10_

- [ ] B5.6 Add the forward-health section to the panel
  - Extend `BacklinksPanel` (from B1.11) with the secondary "outgoing links needing attention" section
    that flags trashed/broken outgoing links from the forward-health read
  - Done when the panel flags trashed/broken outgoing links; the incoming list and empty state are unchanged
  - _Requirements: 6.4_
  - _Boundary: BacklinksPanel_
  - _Depends: B5.4, B5.5, B1.11_

- [ ] B5.7 Subscribe the delete-family lifecycle events
  - Extend the B1.12 subscription with delete/deleteCompletely/syncDescendantsDelete → the B5.3 handlers
  - Done when deleting a page through the app reconciles `PageLink` rows accordingly
  - _Requirements: 3.3, 6.1, 6.2_
  - _Boundary: crowi setup, PageLinkService_
  - _Depends: B5.3, B1.12_

- [ ] B5.8 Integration + E2E tests (delete/broken states)
  - Integration: deleted page is no longer an active source; trash → trashed; permanent delete →
    broken; restore → normal. E2E: an editor viewing a page that links to a trashed/deleted target
    sees the trashed/broken indicator for outgoing links
  - Done when these scenarios pass against the wired service through real trash/delete/restore
    operations and the E2E indicator flow passes
  - _Requirements: 3.3, 6.1, 6.2, 6.3, 6.4_
  - _Depends: B5.7, B5.6_
