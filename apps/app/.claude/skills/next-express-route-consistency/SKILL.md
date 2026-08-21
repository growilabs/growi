---
name: next-express-route-consistency
description: Cross-check the Express-exclusive path list in src/utils/is-next-page-route.ts against the real route registrations in server/routes/index.js and the page files under src/pages/**. Auto-invoked when editing server/routes/index.js, src/utils/is-next-page-route.ts, or src/components/ReactMarkdownComponents/NextLink.tsx, or when asked to check whether NextLink's routing predicate is stale.
user-invocable: true
---

# Next/Express Route Consistency Check

`src/utils/is-next-page-route.ts` decides whether `NextLink` may hand a path to
Next's client-side router or must fall back to a full page load. It answers
this correctly only as long as its `EXPRESS_EXCLUSIVE_PATH_PATTERNS` list
stays in sync with two things that can each drift independently:

1. What `server/routes/index.js` actually registers (adding/removing an
   Express-only route without touching the list).
2. What page files exist under `src/pages/**` (adding a new Next.js page for
   a path that used to be Express-exclusive, without removing it from the
   list).

There is no automated test for this today (the two source-of-truth files are
read by an LLM at review time, not diffed programmatically) — this skill is
the manual substitute. See issue #11689 for the background: `NextLink` used
to reuse `pagePathUtils.isCreatablePage()` (a "can I create a wiki page here"
predicate) for this unrelated "is this a Next.js page route" question, and
the two answers silently diverged over time.

## When to run this

- Whenever `server/routes/index.js` gains or loses a top-level `app.get` /
  `app.use` registration.
- Whenever `src/utils/is-next-page-route.ts` is edited.
- Whenever a new file is added under `src/pages/**` (a new page can turn a
  previously Express-exclusive path into a real Next.js page).
- On request, to answer "is NextLink's routing predicate still accurate?".

## Procedure

1. **Read `EXPRESS_EXCLUSIVE_PATH_PATTERNS`** in
   `apps/app/src/utils/is-next-page-route.ts`. This is the list under test.

2. **Enumerate what Express actually claims**, from
   `apps/app/src/server/routes/index.js`: every top-level `app.get(...)` /
   `app.use(...)` registration whose handler chain does **not** end in
   `next.delegateToNext` (or `pageMarkdown.respond`, which only intercepts
   markdown-flavored requests and falls through otherwise). Note the path
   prefix each one claims.

3. **Enumerate real Next.js pages**, from `apps/app/src/pages/**/*.page.tsx`
   (top-level directory/file names, including dynamic segments like
   `[[...path]]`). Anything not claimed by step 2 ends up served by the
   trailing catch-all `app.get('/*', ..., next.delegateToNext)` — i.e. it is
   a Next.js page route regardless of whether a literal page file exists for
   that exact path (the `[[...path]]` catch-all renders it, even if the
   result is "page not found").

4. **Diff against the list**:
   - A prefix from step 2 that is **not** in `EXPRESS_EXCLUSIVE_PATH_PATTERNS`
     → NextLink will wrongly attempt a client-side transition to a path with
     no Next.js page (issue #11689's "Case A").
   - An entry in `EXPRESS_EXCLUSIVE_PATH_PATTERNS` that no longer matches
     anything Express claims (its route was removed, or a page file now
     exists for it) → NextLink wrongly forces a full page reload where a
     client-side transition would now work (issue #11689's "Case B").

5. Report any drift found, file:line evidence for both sides, and the exact
   list edit needed. Do not silently "fix" the list without surfacing the
   diff — a config path might legitimately want the conservative (full
   reload) behavior for other reasons (see the `UNSAFE_PATH_PATTERNS` list in
   the same file, which is unrelated to this check and answers a different
   question: "is this path safe to hand to next/link at all").

## Out of scope

This skill only checks the `EXPRESS_EXCLUSIVE_PATH_PATTERNS` half of
`is-next-page-route.ts`. It does not review `UNSAFE_PATH_PATTERNS` (malformed
paths, `/edit` suffix, path traversal guards) — those are not about
Express-vs-Next.js routing and do not go stale the same way.
