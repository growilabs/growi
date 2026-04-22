---
name: page-transition-and-rendering-flow
description: Auto-invoked when modifying page transition logic, global atom hydration, or the `[[...path]]` dynamic route. Explains the data flow from SSR/client navigation to page rendering, and the hydration-vs-subsequent-sync rule for global atoms (`currentPathnameAtom`, `currentUserAtom`, `isMaintenanceModeAtom`).
---

# Page Transition and Rendering Flow

## Problem

The page transition path in GROWI spans SSR, client-side navigation, URL normalization, Jotai atom hydration, and asynchronous data fetching. Changes in any one of these layers can cause subtle regressions in other layers:

- Forcing global atom updates during render causes "setState during render of a different component" warnings.
- Moving hydration into `useEffect` without care causes flashes of stale values or hydration mismatches.
- Confusing `router.asPath` vs `props.currentPathname` vs `currentPathnameAtom` leads to inconsistent reads across the transition.

This skill documents the intended flow so that edits preserve invariants.

## Key Actors

1. **`pages/[[...path]]/index.page.tsx`** — Dynamic route component. Runs on server and client. Hydrates page-data atoms (`currentPageDataAtom`, etc.) from `getServerSideProps` output.
2. **`pages/[[...path]]/use-same-route-navigation.ts`** — Detects `router.asPath` changes on the client and *triggers* `fetchCurrentPage`. Always attempts fetch; actual skip is decided inside `useFetchCurrentPage`.
3. **`states/page/use-fetch-current-page.ts`** — Single source of truth for page data fetching. Decides whether a fetch is actually needed (guards against duplicate fetches by comparing decoded path / permalink ID with current atom state). Updates page-data atoms atomically on success to avoid intermediate states.
4. **`pages/[[...path]]/use-shallow-routing.ts`** — After hydration, compares the browser URL with `props.currentPathname` (the server-normalized path) and issues a `router.replace(..., { shallow: true })` to align them.
5. **`pages/[[...path]]/server-side-props.ts`** — `getServerSidePropsForInitial` calls `retrievePageData`, performs path normalization (e.g. `/user/username` → `/user/username/`), and returns data + normalized `currentPathname` as props.
6. **`pages/_app.page.tsx` / `states/global/hydrate.ts`** — Hydrates global atoms (`currentPathnameAtom`, `currentUserAtom`, `isMaintenanceModeAtom`) via `useHydrateGlobalEachAtoms`.

## Flow 1: Server-Side Rendering (first load / reload)

1. **Request received**: server receives request (e.g. `/user/username/memo`).
2. **`getServerSideProps` runs**:
   - `getServerSidePropsForInitial` executes.
   - `retrievePageData` normalizes the path and fetches page data from the API.
   - Returns page data and normalized `currentPathname` as props.
3. **Component renders, atoms initialized**:
   - `[[...path]]/index.page.tsx` receives props and initializes page-data atoms (`currentPageDataAtom`, etc.).
   - `PageView` and children render on the server.
4. **Client-side hydration + URL alignment**:
   - Browser receives HTML; React hydrates.
   - `useShallowRouting` compares browser URL (`/user/username/memo`) against `props.currentPathname` (`/user/username/memo/`).
   - On mismatch, `router.replace(..., { shallow: true })` silently rewrites the browser URL to the server-normalized path.

## Flow 2: Client-Side Navigation (`<Link>` click)

1. **Navigation start**: user clicks `<Link href="/new/page">`. `useRouter` detects URL change and `[[...path]]/index.page.tsx` re-evaluates.
2. **`useSameRouteNavigation` triggers fetch**:
   - Its `useEffect` detects `router.asPath` change (`/new/page`).
   - Calls `fetchCurrentPage({ path: '/new/page' })`. This hook always attempts the call.
3. **`useFetchCurrentPage` decides and executes**:
   - **3a. Path preprocessing**: decodes the path; detects permalink format (e.g. `/65d4...`).
   - **3b. Dedup guard**: compares preprocessed path / extracted page ID against current Jotai state. If equal, returns without hitting the API.
   - **3c. Loading flag**: sets `pageLoadingAtom = true`.
   - **3d. API call**: `apiv3Get('/page', ...)` with path / pageId / revisionId.
4. **Atomic state update**:
   - **Success**: all relevant atoms (`currentPageDataAtom`, `currentPageEntityIdAtom`, `currentPageEmptyIdAtom`, `pageNotFoundAtom`, `pageLoadingAtom`, …) are updated together, avoiding intermediate states where `pageId` is temporarily undefined.
   - **Error (e.g. 404)**: `pageErrorAtom` set, `pageNotFoundAtom = true`, `pageLoadingAtom = false` last.
5. **`PageView` re-renders** with the new data.
6. **Side effects**: after `fetchCurrentPage` completes, `useSameRouteNavigation` calls `mutateEditingMarkdown` to refresh editor state.

## Critical Rule: Global Atom Hydration vs Subsequent Sync

**Rule**: In `useHydrateGlobalEachAtoms` (and similar hooks that run inside `_app.page.tsx`), **do not** use `useHydrateAtoms(tuples, { dangerouslyForceHydrate: true })` to keep atoms aligned with `commonEachProps` across navigations.

### Why

- `useHydrateAtoms` runs during render. With `dangerouslyForceHydrate: true`, it re-writes atom values on *every* render — including navigations when props change.
- Those atoms are subscribed by already-mounted components (e.g. `PageViewComponent`). Writing to them mid-render triggers setState on sibling components during the parent's render, producing:
  > Warning: Cannot update a component (`PageViewComponent`) while rendering a different component (`GrowiAppSubstance`).

### Correct pattern

Split the two concerns:

```ts
export const useHydrateGlobalEachAtoms = (commonEachProps: CommonEachProps): void => {
  // 1. Initial hydration only — so children read correct values on first render
  const tuples = [
    createAtomTuple(currentPathnameAtom, commonEachProps.currentPathname),
    createAtomTuple(currentUserAtom, commonEachProps.currentUser),
    createAtomTuple(isMaintenanceModeAtom, commonEachProps.isMaintenanceMode),
  ];
  useHydrateAtoms(tuples); // force NOT enabled

  // 2. Subsequent sync (route transitions) — run after commit to avoid render-time setState
  const setCurrentPathname = useSetAtom(currentPathnameAtom);
  const setCurrentUser = useSetAtom(currentUserAtom);
  const setIsMaintenanceMode = useSetAtom(isMaintenanceModeAtom);

  useEffect(() => {
    setCurrentPathname(commonEachProps.currentPathname);
  }, [commonEachProps.currentPathname, setCurrentPathname]);

  useEffect(() => {
    setCurrentUser(commonEachProps.currentUser);
  }, [commonEachProps.currentUser, setCurrentUser]);

  useEffect(() => {
    setIsMaintenanceMode(commonEachProps.isMaintenanceMode);
  }, [commonEachProps.isMaintenanceMode, setIsMaintenanceMode]);
};
```

### Trade-off accepted by this pattern

On a route transition, `currentPathnameAtom` is **one render behind** before the effect commits. This is safe because:

- Data fetching (`useSameRouteNavigation`, `useFetchCurrentPage`, `useShallowRouting`) reads `router.asPath` or `props.currentPathname` directly — not `currentPathnameAtom`.
- `useCurrentPagePath` uses `currentPagePathAtom` (page data) as primary and falls back to `currentPathname` only when the page data is absent.
- Jotai's `Object.is` comparison means the effect is a no-op when the value hasn't actually changed, so setters don't need manual guards.

## Source Reference Map

| Concern | File |
|---|---|
| Dynamic route entry | `apps/app/src/pages/[[...path]]/index.page.tsx` |
| SSR props | `apps/app/src/pages/[[...path]]/server-side-props.ts` |
| Route-change trigger | `apps/app/src/pages/[[...path]]/use-same-route-navigation.ts` |
| URL normalization | `apps/app/src/pages/[[...path]]/use-shallow-routing.ts` |
| Page fetch / atom updates | `apps/app/src/states/page/use-fetch-current-page.ts` |
| Page path selector | `apps/app/src/states/page/hooks.ts` (`useCurrentPagePath`) |
| Global atom hydration | `apps/app/src/states/global/hydrate.ts` |
| Global atom definitions | `apps/app/src/states/global/global.ts` |
| App shell | `apps/app/src/pages/_app.page.tsx` (`GrowiAppSubstance`) |

## When to Apply

- Editing any hook under `states/global/` that hydrates from `commonEachProps` / `commonInitialProps`.
- Modifying `useSameRouteNavigation`, `useFetchCurrentPage`, or `useShallowRouting`.
- Adding new global atoms that must stay aligned with server-side props across navigations.
- Touching `_app.page.tsx` render order or provider composition.
- Debugging "setState during render of a different component" warnings originating from `_app.page.tsx` or `GrowiAppSubstance`.

## Common Pitfalls

1. **`dangerouslyForceHydrate: true` for route-sync purposes** — breaks the render model. Use `useEffect` + `useSetAtom` instead.
2. **Moving the initial hydration into `useEffect`** — children reading the atom on first render would see the default (empty) value, causing flashes / hydration mismatches.
3. **Using `currentPathnameAtom` as the trigger for data fetching** — the trigger is `router.asPath`, and the normalized authority is `props.currentPathname`. The atom is for downstream UI consumers only.
4. **Updating page-data atoms one-by-one during a fetch** — always update atomically (success block) to avoid intermediate states visible to `PageView`.
5. **Adding a guard like `if (new !== old) set(new)` for atoms** — unnecessary; Jotai already dedupes on `Object.is`.
