# Implementation Plan

> **Migration approach is an open team decision.** Tasks 1–5 and 7.1–7.3 are independent of how
> the backfill runs and can be implemented immediately. The **backfill** is isolated in **Task 6**
> (+ test 7.4) and reflects the design's current choice — an online, throttled `CronService` job.
> If the team instead chooses a blocking migrate-mongo data migration, Task 6 is the only group
> that changes: 6.1 (job state model) and 6.3 (cron registration) collapse, and 6.2's core logic
> (cursor → extract → in-memory resolve → bulkWrite upsert) moves into the migration file. Nothing
> in Tasks 1–5/7.1–7.3 is affected. Do not start Task 6 until the decision is made.

- [ ] 1. Foundation: data model, types, and indexes
- [ ] 1.1 Define backlinks interfaces and shared types
  - Define the `PageLink` shape (`fromPage`, `toPath`, `toPage`), the backlink DTO returned to
    clients (page id + path, optional target state), and the `LinkTargetState` union
    (`normal` / `trashed` / `broken`)
  - Done when the types compile and are importable by both server and client code
  - _Requirements: 1.8, 6.4_

- [ ] 1.2 Implement the PageLink model with indexes and statics
  - Create the Mongoose model following the `PageTagRelation` precedent (`getOrCreateModel`)
  - Declare indexes `{fromPage}`, `{toPath}`, `{toPage}` and the **unique** `{fromPage, toPath}`
    index that enforces "one source listed once"
  - Declare the statics the service will use (replace-outbound, find-backlink-sources,
    reconcile-deleted, re-resolve-by-path) with typed signatures
  - Done when the model registers and a unit test confirms the unique index rejects a duplicate
    `{fromPage, toPath}` insert
  - _Requirements: 1.5, 3.4_
  - _Depends: 1.1_

- [ ] 1.3 Add the index-creation migration
  - Create a migrate-mongo migration that creates the `PageLink` collection indexes only (no data
    writes), with a `down` that drops the collection
  - This runs at boot regardless of the backfill decision; it must stay fast (no body parsing)
  - Done when running the migration creates the four indexes and the changelog records it once
  - _Requirements: 3.4, 4.1_
  - _Depends: 1.2_

- [ ] 2. Core: link extraction and target resolution (pure logic)
- [ ] 2.1 (P) Implement internal-link extraction from a page body
  - Build a pure function that takes a Markdown body + the page's path and returns a deduplicated
    list of resolved internal page paths, reusing the existing remark/rehype link plugins
    (pukiwiki + relative-links) in a trimmed server processor
  - Recognize standard Markdown, wiki-link (`[[alias>/path]]`), and raw-HTML anchors; exclude
    external URLs, in-page `#` anchors, and links inside code spans/blocks; strip query/anchor;
    normalize paths; gate on `isCreatablePage`; drop the page's self-link
  - Done when unit tests cover each link form and each exclusion rule and assert the deduped,
    self-excluded result
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6_
  - _Boundary: extractInternalLinks_
  - _Depends: 1.1_

- [ ] 2.2 (P) Implement target-page resolution with redirect following
  - Build the live-path resolver: a stored path resolves to a page id by direct path lookup, else
    by following the redirect chain to its endpoint, else null
  - Handle multi-hop renames (A→B→C) via the redirect endpoint lookup; null when neither a page
    nor a redirect resolves (the broken case)
  - Done when unit tests cover direct hit, single and double redirect chains, and the unresolved
    (null) case
  - _Requirements: 5.1, 5.2, 5.3_
  - _Boundary: resolveToPage_
  - _Depends: 1.1_

- [ ] 3. Core: synchronization logic and the backlinks service
- [ ] 3.1 Implement the index synchronization operations
  - Implement the row operations on top of the model: replace a source page's outbound rows from a
    freshly extracted+resolved set; re-resolve inbound rows matching a given path (to repoint stale
    caches when a page appears at that path); reconcile a deleted page by checking its current DB
    state (still trashed → no-op; truly gone → remove its outbound rows and null inbound `toPage`)
  - Done when unit tests show: replacing outbound rows is idempotent; reconcile no-ops a trashed
    page and nulls inbound `toPage` for a permanently-gone page
  - _Requirements: 3.1, 3.2, 3.3, 6.2_
  - _Boundary: page-link-sync, PageLink_
  - _Depends: 1.2, 2.1, 2.2_

- [ ] 3.2 Implement the lifecycle event handlers in the backlinks service
  - Implement service handlers that, given a page lifecycle event, drive the sync operations:
    create/update re-extract the body and replace outbound rows (create also re-resolves inbound
    matches); delete/deleteCompletely/syncDescendantsDelete route to the state-based reconcile
  - Handlers are idempotent and tolerate missing/empty bodies and already-removed pages; they read
    the body from the latest revision when the event payload lacks it
  - Done when unit tests invoke each handler with a fake event payload and assert the resulting row
    changes (created/replaced/removed/nulled)
  - _Requirements: 3.1, 3.2, 3.3, 6.2_
  - _Boundary: PageLinkService_
  - _Depends: 3.1_

- [ ] 3.3 Implement the permission-filtered read queries
  - Implement `findBacklinks` (sources pointing at a page, filtered to readable, non-trashed pages
    via the shared viewer/grant filter, mapped to the DTO) and `findForwardLinkHealth` (a page's
    outbound rows whose derived target state is trashed/broken)
  - Never return unfiltered paths; any count is derived only from the filtered set; derive target
    state from `toPage`/target status rather than a stored flag
  - Done when integration tests show restricted source pages are omitted from results, and forward
    health reports trashed/broken targets with the correct state
  - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 5.3, 6.1, 6.3, 6.4_
  - _Boundary: PageLinkService_
  - _Depends: 3.1_

- [ ] 4. Read API and UI
- [ ] 4.1 (P) Add the backlinks read endpoint
  - Add an authenticated apiv3 GET route that validates a page id, resolves the viewer from the
    request, and returns the permission-filtered backlinks for that page
  - Done when the endpoint returns backlinks for a readable page and 400/403 for invalid id /
    no-access, delegating filtering to the service
  - _Requirements: 1.1, 2.1, 6.4_
  - _Boundary: get-page-backlinks route_
  - _Depends: 3.3_

- [ ] 4.2 Add the client data hook
  - Add an SWR hook keyed by page id (and guest state) that fetches from the backlinks endpoint and
    returns the backlink list
  - Done when the hook returns data for a page and revalidates when the page id changes
  - _Requirements: 1.1_
  - _Boundary: useSWRxBacklinks_
  - _Depends: 4.1_

- [ ] 4.3 (P) Build the backlink list-item component
  - Build a presentational row showing a linked page's title and path (reusing existing page-path
    label components) plus a target-state badge for trashed/broken targets
  - Done when the component renders title + path for a normal link and shows the badge for
    trashed/broken targets
  - _Requirements: 1.8, 6.4_
  - _Boundary: BacklinkListItem_
  - _Depends: 1.1_

- [ ] 4.4 Build the backlinks panel
  - Build the panel that lists incoming links via the hook, renders an explicit empty state when
    there are none, and shows a secondary "outgoing links needing attention" section from forward
    health
  - Done when the panel shows the backlink list, the empty state with no backlinks, and the
    forward-health section flags trashed/broken outgoing links
  - _Requirements: 1.1, 1.7, 1.8, 6.4_
  - _Boundary: BacklinksPanel_
  - _Depends: 4.2, 4.3_

- [ ] 5. Integration: wire into the running app
- [ ] 5.1 Subscribe the backlinks service to page lifecycle events
  - Instantiate and initialize the backlinks service in the server setup phase (mirroring the
    search service), subscribing its handlers to create/update/delete/deleteCompletely/
    syncDescendantsDelete; do not modify the page service
  - Done when creating, editing, and deleting a page through the app changes `PageLink` rows
    accordingly (verified by an integration test that drives real lifecycle calls)
  - _Requirements: 3.1, 3.2, 3.3_
  - _Boundary: crowi setup, PageLinkService_
  - _Depends: 3.2_

- [ ] 5.2 (P) Register the backlinks endpoint
  - Register the read route in the apiv3 router
  - Done when the endpoint is reachable over HTTP and returns backlinks for a seeded page
  - _Requirements: 1.1_
  - _Boundary: apiv3 router_
  - _Depends: 4.1_

- [ ] 5.3 (P) Add the Backlinks tab to the page accessories UI
  - Add a Backlinks entry to the page-accessories tab mapping that renders the panel
  - Done when opening the tab on a page displays the backlinks panel
  - _Requirements: 1.1_
  - _Boundary: PageAccessoriesModal_
  - _Depends: 4.4_

- [ ] 6. Backfill of pre-existing pages — APPROACH PENDING TEAM DECISION (do not start until decided)
  - Reflects the design's current choice: an online, throttled, resumable background job. If a
    blocking migrate-mongo data migration is chosen instead, collapse 6.1/6.3 and move 6.2's loop
    into the migration. Either way the extract→resolve→bulkWrite core is the same and reuses 2.1.
- [ ] 6.1 Add the backfill job state model
  - Add a single-document model tracking backfill status, a progress marker (resume point), and an
    atomic-claim field so only one instance runs the job and it stops once complete
  - Done when a unit test shows the claim succeeds once and is rejected for a second concurrent
    claimant
  - _Requirements: 4.3_
  - _Boundary: PageLinkBackfillJob_
  - _Depends: 1.2_

- [ ] 6.2 Implement the throttled, resumable backfill job
  - Implement a cron-based job that, per tick, processes a bounded chunk of pages: build/reuse an
    in-memory path→id map (one projection query) for resolution instead of per-link lookups,
    extract links via the core extractor, and bulk-upsert rows; persist the progress marker after
    each chunk and resume from it on restart
  - Throttle via cron cadence × chunk size; skip immediately once the job document is complete
  - Done when running the job over a seeded dataset populates rows equivalent to the live path, a
    re-run/resume adds no duplicates, and progress is emitted on the admin channel
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: PageLinkBackfillCron_
  - _Depends: 6.1, 2.1, 1.2_

- [ ] 6.3 Register and trigger the backfill job
  - Register the backfill cron in server setup; trigger it per the chosen policy (auto-start
    throttled, or admin-triggered) — wire whichever the team selects
  - Note: this edits the same server-setup file as 5.1; sequence after 5.1 to avoid a merge
  - Done when, after boot, the job claims and runs to completion on a fresh dataset and marks
    itself complete so it does not re-run
  - _Requirements: 4.1_
  - _Boundary: crowi setup, PageLinkBackfillCron_
  - _Depends: 6.2, 5.1_

- [ ] 7. Validation
- [ ] 7.1 Integration tests for lifecycle, permissions, rename/move, and delete states
  - Cover: create/update add and remove backlinks; deleted page is no longer an active source;
    backlinks exclude pages the viewer cannot read and reflect grant changes; inbound links survive
    rename/move (including descendants) with no index writes; trash → trashed, permanent delete →
    broken, restore → normal
  - Done when these scenarios pass against the wired service through real lifecycle operations
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 5.1, 5.2, 6.1, 6.2, 6.3_
  - _Depends: 5.1_

- [ ] 7.2 E2E test for the backlinks panel
  - Verify the Backlinks tab lists linking pages with title + path, shows the empty state when none
    exist, and indicates trashed/deleted targets for outgoing links
  - Done when the E2E flow passes for the populated, empty, and trashed/broken-target cases
  - _Requirements: 1.1, 1.7, 1.8, 6.4_
  - _Depends: 5.3_

- [ ] 7.3 Performance check for backlinks retrieval at scale
  - Verify a heavily-linked page's backlinks return in interactive time (<~1s) on a large
    (~100k-page) dataset, exercising the `{toPage}` index and the viewer filter
  - Done when a measured retrieval against the large dataset meets the latency target
  - _Requirements: 3.4_
  - _Depends: 5.1, 5.2_

- [ ] 7.4 Backfill tests — PENDING TEAM DECISION (pairs with Task 6)
  - Verify backfill output matches the live path; running twice or resuming after an interrupted
    chunk produces no duplicates; the atomic claim prevents two instances/ticks double-processing
  - Done when these pass against a seeded dataset
  - _Requirements: 4.1, 4.2, 4.3_
  - _Depends: 6.2_
