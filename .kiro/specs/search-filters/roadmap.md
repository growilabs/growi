# Roadmap

## Overview
Extend GROWI's search page with a discoverable Filter Bar that lets users narrow results by Author, Path, Created Date, Updated Date, and Group. Filters persist state in URL query parameters for deep-linking and integrate with the existing Elasticsearch query pipeline via new dedicated API parameters.

This is a single-spec project. The Filter Bar uses a Static Plugin Registry architecture: each filter is a self-contained descriptor implementing a shared `FilterPlugin<T>` interface, registered in a static array. `FilterBar` is a dumb renderer — adding a new filter in the future requires one new file and one registry line, no changes to the container.

## Approach Decision
- **Chosen**: Static Plugin Registry (Approach A)
- **Why**: GROWI's search filters are a finite, known set. The complexity is in the serialization contract (UI ↔ URL ↔ Elasticsearch), not in dynamic state distribution. Approach A keeps that contract explicit and co-located in each plugin descriptor, avoids new state primitives (`atomWithHash`) or React Context overhead, and is fully type-safe with discriminated unions.
- **Rejected alternatives**:
  - Jotai Atom Registry (Approach B): Adds `atomWithHash` or custom derived atoms; registration ceremony is complex for a finite filter set; atom-per-filter creates indirection without clear benefit
  - React Context Registry (Approach C): Self-registration via `useEffect` creates mount-ordering fragility; Context re-renders on any filter state change; harder to test

## Scope
- **In**: `FilterPlugin` interface and registry, `FilterBar` container, `useFilterUrlSync` hook, five concrete filter plugins (Author, Path, Created Date, Updated Date, Group), server-side `/search` API extension, `SearchService` ES query extension, integration into `SearchPage`/`SearchControl` layout
- **Out**: Tag filter UI, saved/named filter sets, mobile `SearchOptionModal` extension, admin filter configuration, ES schema changes, audit log filter bar

## Constraints
- All new source files under `apps/app/src/features/search/`
- No server-side imports from client components (server-client boundary)
- Elasticsearch extensions via existing `ElasticsearchDelegator` only; no new ES client
- URL params (`author`, `path`, `createdFrom`, `createdTo`, `updatedFrom`, `updatedTo`, `group`) must not collide with existing `q`, `sort`, `order`, `nq`, `limit`, `offset`
- Reactstrap + Bootstrap 5 UI; no new global CSS imports from client (Turbopack restriction)
- Author and Group IDs: client sends string ObjectIds; server validates and converts

## Boundary Strategy
- **Why this split** (within the single spec): The plugin interface layer, URL sync layer, server integration layer, and five concrete plugins are kept in separate files so each can be reviewed, tested, and extended independently
- **Shared seams to watch**: `FilterPlugin.toElasticsearchClause()` return type must exactly match what `SearchService` expects — this is the critical interface between client plugin descriptors and server query building

## Specs (dependency order)
- [ ] search-filters -- Search Filter Bar framework with Author, Path, Created Date, Updated Date, and Group plugins. Dependencies: none
