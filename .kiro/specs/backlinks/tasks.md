# Implementation Plan

> **Organized by story, not by architectural layer.** The five stories (B1–B5) are vertical,
> shippable slices; this plan is sequenced so each story is a **contiguous block** you can build and
> verify end-to-end before starting the next — no skipping around. B1 carries the shared foundation
> (model, indexes, extractor, service, read path, panel) because the first vertical slice always
> carries the walking skeleton; B2–B5 graft onto it.
>
> **Where a capability was split across stories**, the task notes call it out explicitly:
> `resolveToPageIds`, the sync ops, the lifecycle handlers, the read queries, `BacklinkListItem`,
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
  - Define the `IPageLink` edge shape (`fromPage`, `toPath`, `toPage`) and the incoming-backlinks DTO
    `IBacklink` (page id + path; always healthy)
  - **B1 scope: the outgoing-health types are deferred to B5.** `ILinkTarget` (page id + path +
    required target state) and the `LinkTargetState` union (`normal` / `trashed` / `broken`) are
    declared by the tasks that first produce them — the union in **B5.1** (with its derivation helper)
    and the DTO in **B5.4** (with the forward-health read). The design's DTO section (§ Data Models)
    remains the target shape. _Revised from the original plan, which declared both up front in B1.1;
    B1 shipped without them, and introducing a type in the story that produces it keeps the type and
    its only producer in one reviewable change._
  - Done when the types compile and are importable by both server and client code
  - _Requirements: 1.8_

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
  - _Boundary: extractInternalLinkPaths_
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
  - _Boundary: resolveToPageIds_
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
  - _Boundary: getBacklinksHandlerFactory (routes/backlinks.ts)_
  - _Depends: B1.7_

- [x] B1.9 Add the client data hook
  - Add an SWR hook keyed by page id (and guest state) that fetches from the backlinks endpoint and
    returns the backlink list
  - Done when the hook returns data for a page and revalidates when the page id changes
  - _Requirements: 1.1_
  - _Boundary: useSWRxBacklinks_
  - _Depends: B1.8_

- [x] B1.10 Build the backlink list-item component — title + path only
  - Build a presentational row showing a linked page's title and path (reusing existing page-path
    label components)
  - **B1 scope:** skip the trashed/broken target-state badge (B5.5)
  - Done when the component renders title + path for a normal link
  - _Requirements: 1.8_
  - _Boundary: BacklinkListItem_
  - _Depends: B1.1_

- [x] B1.11 Build the backlinks panel — incoming list + empty state
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

- [x] B1.14 Add the Backlinks tab to the page accessories UI
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

- [x] B1.16 E2E test for the backlinks panel (B1 slice)
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

- [x] B2.1 Performance check for backlinks retrieval at scale (read-path)
  - A measurement exercise, not a feature build: prove Req 3.4's target and locate any bottleneck
    while it is still a cheap, pre-merge index fix. Pure read benchmark on a statically seeded
    dataset — independent of B2.2's write pacing.
  - **Seed** ~100k pages with realistic internal linking, deliberately including a **heavily-linked
    hub page** (thousands of inbound sources) — the worst case for the read path and the page you
    actually measure. Use a throwaway/fixture seeding script, **not** the B3 backfill job.
  - **Confirm the indexes exist** on the seeded collection (created by B1.2 `autoIndex`) — a check,
    not new work. The collection carries exactly two: `{toPage}` (what this benchmark exercises, via
    `findBacklinkSources`) and the unique `{fromPage, toPath}` compound. The standalone `{fromPage}`
    and `{toPath}` indexes were dropped in B2.2 as unused, so their absence is expected, not a gap —
    `{fromPage}` is the compound's prefix, and `toPath`-alone gets its index in B4 with the query
    that needs it.
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
  - **Decision made:** an env-gated integ test, not a CI test and not a standalone script —
    `server/services/page-link-read-perf.integ.ts`. It is collected by the normal
    `app-integration` project but every test is skipped unless `BACKLINKS_PERF` is set, so CI never
    pays the seed, while the measurement stays runnable/repeatable in-tree and reuses the crowi test
    harness (so it measures the real `findBacklinks`, with no hand-rolled model bootstrap to drift).
  - Done when a measured retrieval against the ~100k-page dataset meets the <~1s target, the
    `explain()` evidence shows the query is index-backed, and the no-rescan guarantee is confirmed
    (plus any surfaced index/query fix is applied)
  - _Requirements: 3.4_
  - _Depends: B1.12, B1.13_

  **Result — measured 2026-07-31. Target met with ~8x headroom; no index/query fix needed.**

  How to reproduce:
  ```
  MONGO_URI=mongodb://mongo:27017/growi?replicaSet=rs0 \
    BACKLINKS_PERF=1 pnpm vitest run page-link-read-perf
  ```
  (The harness rewrites the db name to `growi_test_<workerId>`, so the dev `growi` database is never
  touched. `BACKLINKS_PERF_PAGES` / `BACKLINKS_PERF_INBOUND` override the scale.) Safe against the
  shared devcontainer mongod — the warm runs only read and write their own database. The cold-cache
  run is **not**; it needs the separate procedure below.

  Environment: devcontainer MongoDB 8.2.9, wiredTiger, `rs0` single-node replica set, 16 cores /
  15.9 GB. Dataset: 100,001 pages, 205,000 link rows, hub page with 5,000 inbound sources. Pages
  carry the full real field set (`revision`, `creator`, `lastUpdateUser`, `parent`, `seenUsers`, …),
  giving a **427 B average document** against the 384 B seen in a real wiki — document size is what
  the FETCH-and-project read actually pays, so a stripped 185 B page would have understated it.

  Hub sources are mixed so the viewer filter really sifts: 60% public, 10% granted to a group the
  viewer belongs to, 10% granted to a group they don't, 10% owned by someone else, 5% owned by the
  viewer, 5% trashed ⇒ 3,750 of 5,000 visible. The viewer is a member of two real `UserGroup`s, so
  `generateGrantCondition` emits its `grantedGroups: {$elemMatch: …}` branch — without groups seeded
  that branch is omitted and the measured query would be structurally simpler than a real member's.
  The visible count is asserted, so this doubles as a correctness check at scale.

  | measurement | 5,000 inbound | 20,000 inbound |
  |---|---|---|
  | `findBacklinks` (full read path) | **median 128 ms** (min 122 / max 138) | **median 192 ms** (min 168 / max 216) |
  | └ `findBacklinkSources` (`distinct` on `{toPage}`) | median 7 ms | median 29 ms |
  | └ viewer-filtered `Page` query | median 115 ms | median 150 ms |

  One run's samples; repeated runs land at a 116–130 ms median for the 5,000-inbound case, with the
  max the noisy figure since the devcontainer shares its CPU. Read the medians as ~an order of
  magnitude under the target, not as a precise figure to regression-test against.

  **Cold cache** (`BACKLINKS_PERF_COLD=1` shrinks the server's WiredTiger cache below the working set,
  then restores it) — answers what happens when the pages are *not* already in memory:

  | cache vs working set | first read | settled median |
  |---|---|---|
  | 64 MiB vs 80 MiB (1.25x) | 163 ms | 128 ms |
  | 8 MiB vs 155 MiB (19x) | 141 ms | **164 ms** |

  Even with the cache 19x too small to hold the data, the read is 164 ms — still ~6x under target. So
  the warm figures are not an artifact of everything being cache-resident.

  **Never run the cold-cache test against the shared devcontainer mongod.** It shrinks the cache with
  `setParameter: {wiredTigerEngineRuntimeConfig: 'cache_size=…M'}`, which is **process-wide** — the
  `growi_test_<workerId>` database isolation that makes the warm runs safe does not apply. The restore
  is a `finally`, so it survives a failing assertion but not the process being killed (Ctrl-C, a
  vitest timeout kill, the container stopping). Killed mid-run against the shared instance, mongod
  keeps the 64 MiB cache until it is restarted, silently slowing every later dev request, integ test,
  and benchmark run — including the next run of this very test, which would then report a degraded
  baseline as if it were the real number.

  So give it a throwaway mongod of its own, and let discarding the container be the restore. The
  devcontainer has no `docker` CLI and `mongo` is a sibling compose service, so the container is
  started **from the host**, attached to the devcontainer's network so the test can reach it by name:
  ```
  # on the host — network name follows the compose project, so look it up rather than guessing
  docker network ls --filter name=default
  docker run --rm -d --name mongo-b21-cold --network <that-network> \
    mongo:8.2 --replSet rs0 --bind_ip_all
  docker exec mongo-b21-cold mongosh --quiet --eval 'rs.initiate()'
  ```
  ```
  # in the devcontainer — note the host is mongo-b21-cold, NOT the shared mongo
  MONGO_URI=mongodb://mongo-b21-cold:27017/growi?replicaSet=rs0 \
    BACKLINKS_PERF=1 BACKLINKS_PERF_COLD=1 pnpm vitest run page-link-read-perf
  ```
  ```
  # on the host — this IS the restore: the shrunk cache dies with the container
  docker rm -f mongo-b21-cold
  ```
  (`BACKLINKS_PERF_COLD_CACHE_MB` sets the shrunk ceiling, default 64. The throwaway has no data
  volume, so seeding 100k pages lands in its container filesystem; lowering `BACKLINKS_PERF_PAGES` is
  fine here — the cold conclusion rests on the cache-to-working-set *ratio*, not the absolute scale.)

  - **Where the time goes:** the viewer filter, not the `distinct` — ~90% of the total. It is a
    `_id: {$in: [5k ids]}` fetch plus the grant `$or`, so it scales with the number of sources, which
    is the expected shape.
  - **Scaling:** 4x the inbound rows costs only ~1.5x latency (128 → 192 ms), i.e. sub-linear and
    still 5x under target. Extrapolating, the 1 s budget is not at risk until a hub reaches roughly
    100k inbound sources.
  - **Document size and group grants barely moved the number:** 2.3x bigger documents plus the extra
    `$elemMatch` branch cost ~1 ms (127 → 128 ms). Both were fixed because the earlier seed made the
    result *look* optimistic, not because the correction turned out to matter.
  - **Plans (all index-backed, no COLLSCAN anywhere):** `distinct` → `FETCH <- IXSCAN` on `toPage_1`;
    viewer filter → `PROJECTION_SIMPLE <- FETCH <- IXSCAN` on `_id_`; the save-path delete filter
    (`{fromPage, toPath: {$nin}}`) → `FETCH <- IXSCAN` on `fromPage_1_toPath_1`.
  - **No-rescan confirmed:** one `syncOutboundLinks` issues exactly one `bulkWrite` whose every
    operation filter is scoped to the edited `fromPage`; a sibling page's rows are byte-identical
    afterwards and the collection total moves only by that page's delta.
  - **The `distinct` is not covered, and the fix for that was measured and rejected.** It runs
    `FETCH <- IXSCAN`, not `DISTINCT_SCAN`, because its key (`fromPage`) is not in the index it rides
    (`{toPage}`) — so Mongo opens each matching row to read one field. A `{toPage, fromPage}` compound
    makes the query covered. `measurements/b21-index-cost.mjs` measures what that costs and buys
    (205k rows, A/B/A' against drift):

    | | 2 indexes | + `{toPage, fromPage}` | |
    |---|---|---|---|
    | storage | — | **+3.2 MiB** (~16 B/row; ~150 MiB at 10M rows) | modest |
    | per-save write (10 links) | 6.05 ms | **6.04 ms** | no measurable cost |
    | `distinct`, 1 row per source→target | 7.3 ms | **10.1 ms** | **44% worse** |
    | `distinct`, 3 rows per source→target | 13.3 ms | **9.0 ms** | 39% better |

    **Not added — because it makes the common case slower, not because it costs too much.**
    `DISTINCT_SCAN`'s advantage is skipping duplicate keys; when each source links a target once,
    every `fromPage` under a `toPage` is already unique, so there is nothing to skip and the wider
    index is pure overhead. It only pays when a source links the same target several ways (path +
    permalink + anchor all resolving to one page — the case B1.15 asserts is de-duplicated).

    Revisit if real wikis turn out to average ≥2 rows per source→target pair; measure that first, with
    the script above. A `{toPage, fromPage}` index also cannot serve `toPath` alone, so it does not
    pre-empt the index B4 needs.

    > Corrects an earlier note here that justified skipping the index by "per-save write cost B2.2
    > just removed". That was asserted without measurement and is wrong: the write cost is
    > unmeasurable. The real reason is the negative read effect above.

- [x] B2.2 Coalesce and pace live extraction (write-path burst control)
  - Replace the B1.6/B1.12 inline per-event extraction with an in-process coalescing queue: the
    `create`/`update` handlers mark the page dirty (`Set<pageId>`); a paced drain re-reads each
    page's latest body at drain time and runs the existing upsert handler once per page.
    `handlePageUpsertById` stays the per-page unit — the queue is the seam. Pacing is a deployment
    knob, not a constant: the coalescing window is `backlinks:drainIntervalMs`
    (`BACKLINKS_DRAIN_INTERVAL_MS`, default 1000 ms) and the share of the event loop the queue may
    occupy is `backlinks:dutyCyclePercent` (`BACKLINKS_DUTY_CYCLE_PERCENT`, default 20), both read
    at service construction and passed into the queue. A drain runs until the queue is empty,
    resting after each page in proportion to the extraction time it measured — see design.md B2.2
    for why the original per-tick page budget (`BACKLINKS_MAX_PAGES_PER_DRAIN`, 3 pages) was
    replaced after review.
  - **B2.2 scope (delete):** the drain guards against a stale upsert by re-checking status at drain
    time and declining to index a page that is now `STATUS_DELETED` — keyed on deleted rather than
    published because a legacy page's `null` status means published. That closes the window
    coalescing opened (a soft delete keeps the `_id`, so the "page is gone" check does not catch it).
    Routing the delete to `reconcileDeletedPages` and clearing the rows the page already owned needs
    the reconcile op and the delete-family handlers — deferred to **B5.2**/**B5.3**.
  - Best-effort/in-memory by design: a restart drops pending work (self-heals on next edit/backfill);
    the set is per-instance in multi-container deployments (safe because upserts are idempotent).
  - **Accepted limitation (review of B2.2):** a page whose upsert fails is retried on a later drain
    after `RETRY_BACKOFF_MS`, up to `MAX_UPSERT_ATTEMPTS` attempts; past that the queue gives up and
    logs the page at error level, and its rows stay stale until its next save or B3. The queue has a
    single drain timer, so a save arriving during a retry backoff waits for it too.
  - **Accepted limitation (review of B2.2):** an upsert that never settles leaves the drain flag set,
    and the instance then stops indexing until it restarts. Not guarded with a timeout, because a
    timeout cannot cancel the abandoned run — it would race it, and a resurrected stale run would
    overwrite a newer link set. Same repair path as any dropped work: the page's next save, or B3.
  - **Why (MongoDB impact):** every save runs `PageLink.replaceOutboundLinks`, a single `bulkWrite`
    that upserts one row per extracted link and issues a `deleteMany` for links no longer present —
    each component write maintaining every `pagelinks` index. This story also cut those from four to
    the two an actual query uses — unique `{fromPage, toPath}` and `{toPage}`; the standalone
    `{fromPage}` (already the compound's prefix) and `{toPath}` (no query until B4) were pure write
    overhead. Without coalescing, N rapid saves of one page = N full
    `bulkWrite` replaces of which N−1 are immediately obsolete, yet each still re-upserts every row,
    re-scans for the `deleteMany`, rewrites every index B-tree, and (under the `rs0` replica set)
    emits oplog entries that replicate to secondaries. A burst across distinct pages runs these
    `bulkWrite`s concurrently, contending for write tickets and collection locks with the
    latency-sensitive backlinks read (`findBacklinkSources`, a `distinct` on `{toPage}`) — so the
    write storm is what actually slows reader queries at the storage-engine level. Coalescing
    collapses same-page saves to **one** `bulkWrite` reflecting only the final link set (safe because
    `replaceOutboundLinks` is idempotent), cutting write volume, index maintenance, and oplog/
    replication traffic from N to 1; pacing then spreads distinct-page `bulkWrite`s in proportion to
    each page's extraction cost, converting an unbounded write spike into steady, bounded write QPS
    that coexists with reads. Delete must
    supersede a pending upsert because the upsert path uses `upsert: true` — running a stale upsert
    for a since-deleted page would re-create `pagelinks` rows for a non-existent source (orphan rows
    a reader could surface as phantom backlinks).
  - Done when: repeated saves of the same page within the coalescing window produce exactly one
    extraction / one `replaceOutboundLinks` `bulkWrite` (asserted via a spy/count on the upsert
    handler); a burst of distinct-page saves is paced by measured extraction cost rather than run as
    one back-to-back spree (a page costing 10x as much to extract earns 10x the rest); a source that
    is `STATUS_DELETED` at drain time is not indexed, even when the event payload still reads as
    published (no row written for it); a page whose upsert fails is retried on a later drain rather
    than dropped, and abandoned with an error log after `MAX_UPSERT_ATTEMPTS`.
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

- [ ] B3.5 Index the descendants of a recursive duplicate
  - Gap found in review of B2.2. A recursive duplicate bulk-inserts the copied descendants
    (`PageService.duplicateDescendants` → `Page.insertMany`) and emits no per-page event, so their
    outbound links are never extracted. The duplicated **root** is already covered: it goes through
    `PageService.create`, which emits `create`. Not fixable inside this feature — `duplicate` carries
    the *source* page and fires *before* `duplicateDescendantsWithStream` runs, so the copies do not
    yet exist and their ids are never published.
  - Note: the Elasticsearch index has the same blind spot (nothing subscribes to `duplicate`, and no
    `syncDescendantsUpdate` is emitted here), so the fix belongs in `PageService` and should be decided
    for search and backlinks together rather than worked around per-consumer.
  - Options: (a) emit a descendants-created event from `duplicateDescendants` and subscribe to it;
    (b) accept the gap and let the B3 backfill repair it, documenting that a recursive duplicate is
    not indexed until then
  - Done when a duplicated subtree's descendants appear as backlink sources in an integration test, or
    option (b) is recorded here as an accepted limitation with the user-visible effect stated
  - _Requirements: 3.1, 3.2_
  - _Boundary: PageService (page events), PageLinkService_
  - _Depends: B1.12_

---

## Story B4 — Link integrity across rename / move

**Nature:** Extends resolution so inbound links survive a target's rename/move. Rename/move emit no
usable event and need none: `_id`-stable `toPage` keeps links cached before the move valid, and
redirect-following keeps links resolvable when the source is re-saved after the move. This story adds
the redirect-following half of resolution plus the re-resolve-by-path repointing. Independent of
B3/B5.

- [x] B4.1 Add redirect-chain following to resolveToPageIds
  - Extend the resolver with the redirect step deferred from B1.4: follow the redirect chain to its
    endpoint and resolve there; handle multi-hop renames (A→B→C) via the redirect endpoint lookup;
    unresolved when neither a page nor a redirect resolves (the broken case). A permalink `toPath`
    still short-circuits by id (never needs redirect-following — 5.4)
  - **Match page view's precedence**: a redirect on the path outranks a live page at it, because
    `resolvePathAndCheckIdentical` follows the redirect without checking for a live page at the
    requested path. So the chain is looked up for **every** path in one lookup, not only for the
    ones that missed — a live hit does not settle the answer
  - Add the lookup as a new `PageRedirect.retrievePageRedirectEndpointsBatch` static and
    re-implement the existing singular `retrievePageRedirectEndpoints` over it, so the
    `$graphLookup` pipeline and deepest-hop rule exist once and page view cannot disagree with the
    link index about where a chain ends. Keep the depth cap a **parameter**: the save path passes
    50, page view passes none (a cap there turns a much-renamed page's old URL into a not-found)
  - Done when tests cover single and double redirect chains resolving to the endpoint, a redirect
    winning over a live page at the same path, the unresolved case, several paths resolving in one
    lookup, converging chains keyed by input, a cycle advancing one hop rather than hanging, an
    uncapped walk running past the save path's cap, and a trashed target resolving through its trash
    redirect rather than reading as broken
  - _Requirements: 1.9, 5.1, 5.2, 5.3, 5.4_
  - _Boundary: resolveToPageIds, PageRedirect (batch static)_
  - _Depends: B1.4_

- [x] B4.2 Implement the re-resolve-by-path sync operation
  - Implement the row op deferred from B1.5: re-resolve inbound rows matching a given path (to repoint
    stale caches when a page appears at that path)
  - **Not only exact `toPath` matches.** B4.1 made resolution follow the redirect chain, so a row
    naming `/old` resolves here whenever `/old` redirects here — and it goes stale on the same event.
    Walk back from the path (`PageRedirect.retrieveFromPathsRedirectingTo`) to nominate candidates,
    then let `resolveToPages` decide where each one lands: a longer chain can carry a candidate past
    this path, so the reverse hop must never supply the target itself
  - Done when tests show inbound rows for a path get their `toPage` repointed when a page resolves
    at that path. The service's forwarding (which target it hands to the write) is unit-tested; the
    resulting row state is integration-tested against a real collection, since that is the
    observable contract
  - _Requirements: 5.1, 5.2_
  - _Boundary: page-link-sync, PageLink_
  - _Depends: B1.2, B4.1_

- [x] B4.3 Wire re-resolve into the create handler
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

- [ ] B4.5 Bound how many chains one redirect lookup walks
  - Deliberately deferred out of B4.1 (judged out of that PR's scope), and independent of
    B4.2–B4.4 — pick it up at any point after B4.1.
  - B4.1 capped the *depth* of a chain (`maxDepth: 50` from the save path) but nothing caps the
    *width*: `retrievePageRedirectEndpointsBatch` receives every link path on the page, and B4.1's
    precedence decision means it receives them on **every** save rather than only the ones that
    missed. `$graphLookup` is memory-bound at 100MB and cannot spill to disk, so a page carrying
    thousands of links (generated content, imported trees) can fail the aggregation outright — the
    same failure mode the depth cap was added to prevent, reached through width instead.
  - **Why it matters more than the raw failure**: `PageLinkService.onUpsert` catches and logs the
    error without acting on it, so the page's `PageLink` rows silently stop being updated on that
    save and every save after it. There is no signal in the UI and no retry.
  - Fix: chunk `fromPaths` inside the static (one aggregation per chunk, results merged into the same
    map) so the caller cannot exceed the bound by passing a large set. Keep the chunk size a
    constant in the model, next to the reason — callers should not have to know it.
  - Consider covering `removePageRedirectsByToPath` in the same pass: it walks the graph the other
    way and is also unbounded, though it runs on delete rather than on save.
  - Done when a unit or integ test shows a `fromPaths` set larger than the chunk size resolves every
    input in more than one aggregation, with the same result as a single-chunk run
  - _Requirements: 5.1, 5.2_
  - _Boundary: PageRedirect (batch static)_
  - _Depends: B4.1_

---

## Story B5 — Broken / trashed link handling on deletion

**Nature:** Adds the delete-family reconcile, the derived target-state (`trashed`/`broken`), the
forward-link-health read, and the UI that surfaces it. Restore needs no write — derived state reads
the restored page's status. Independent of B3/B4.

- [ ] B5.1 Add the reconcile static and target-state derivation
  - Implement the reconcile-deleted static on the model (signature declared in B1.2) and the
    `LinkTargetState` derivation helper (`toPage == null` → `broken`; target trashed → `trashed`; else
    `normal`) — state is derived, never stored
  - **Declare the `LinkTargetState` union here** (deferred from B1.1) in `interfaces/backlink.ts`, in the
    shape the design's § Data Models DTO section specifies
  - Done when unit tests cover the three derived states from `toPage`/target status
  - _Requirements: 6.1, 6.2, 6.3_
  - _Boundary: PageLink, page-link-sync, interfaces/backlink.ts_
  - _Depends: B1.2_

- [ ] B5.2 Implement the reconcile-deleted sync operation
  - Implement the reconcile op deferred from B1.5: reconcile a deleted page by checking its current DB
    state — still trashed → no-op (derived state shows trashed); truly gone → remove its outbound rows
    and null inbound `toPage` (broken)
  - **Carried over from B2.2:** delete must supersede a pending coalesced upsert. B2.2 only stops the
    drain from writing *new* rows for a page that is now `STATUS_DELETED`; the rows the page already
    owned when it was trashed are still there, so this op is what actually settles them. The upsert
    path uses `upsert: true`, so a stale upsert for a since-gone page would re-create rows for a
    non-existent source — orphan rows a reader could surface as phantom backlinks.
  - Done when unit tests show reconcile no-ops a trashed page and nulls inbound `toPage` for a
    permanently-gone page, and a delete landing while an upsert is pending ends in the reconciled
    state rather than a re-created row
  - _Requirements: 3.3, 3.5, 6.1, 6.2_
  - _Boundary: page-link-sync_
  - _Depends: B5.1_

- [ ] B5.3 Implement the delete-family lifecycle handlers
  - Implement the service handlers deferred from B1.6: delete/deleteCompletely/syncDescendantsDelete
    all route to the state-based reconcile. Idempotent; tolerate already-removed pages
  - Also drop the page id from `PageLinkUpsertQueue`'s dirty set here, so a pending upsert is
    abandoned rather than merely declined at drain time (the queue side of B5.2's carried-over
    criterion)
  - Done when unit tests invoke each handler with a fake event payload and assert the resulting row
    changes (removed/nulled)
  - _Requirements: 3.3, 6.1, 6.2_
  - _Boundary: PageLinkService_
  - _Depends: B5.2, B1.6_

- [ ] B5.4 Implement the forward-link-health read query
  - **Declare the `ILinkTarget` DTO here** (deferred from B1.1) in `interfaces/backlink.ts`, in the shape
    the design's § Data Models DTO section specifies — `targetState` required
  - Implement `findForwardLinkHealth` (a page's outbound rows whose derived target state is
    trashed/broken, mapped to `ILinkTarget`); derive target state from `toPage`/target status rather
    than a stored flag
  - **Filter the targets through the shared viewer/grant filter.** `ILinkTarget` returns the
    target's `path`, and B4.1 made resolution follow the rename chain, so a `toPage` can point at a
    page that has since moved somewhere the viewer cannot read. Without this filter the endpoint
    leaks private paths to anyone who can read the linking page. `findBacklinks`' filter is on the
    *source* pages and does not cover this
  - A row whose own source is the target caches `null` (B4.2 clears it so a stale target cannot
    survive as a phantom backlink), so it reads as `broken` although the path resolves. Do **not**
    report it as a broken link — it is transient and `dropSelfLinks` removes the row on the source's
    next save
  - Done when an integration test shows forward health reports trashed/broken targets with the correct
    state, **and** that a target the viewer cannot read is omitted, **and** that a self row is not
    reported as broken
  - _Requirements: 5.3, 6.1, 6.2, 6.3, 6.4, 2.1_
  - _Boundary: PageLinkService, interfaces/backlink.ts_
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
