# Page API Responses Must Not Leak Existence (403 vs 404)

Scope: **any apiv3 endpoint** under `apps/app/src/server/routes/apiv3` that
acts on or reads a page identified by `pageId`/`path` — GET included, not
just write/mutation routes. Any authenticated caller can hit a GET endpoint
the same way they'd hit a POST/PUT/DELETE one, so the HTTP method is not a
meaningful boundary for this leak.

This rule does **not** cover the Next.js page-render screen
(`src/pages/[[...path]]/**` — what a browser shows when a human navigates to
a page). Whether *that* surface should show a different screen for
"forbidden" vs "not found" is a separate, larger UX decision that has not
been made yet, and is out of scope here. Everything else that returns JSON
from `apps/app/src/server/routes/apiv3` — GET included — is in scope and
must follow this rule.

## The rule

When a route looks up its target page via `findPageAndMetaDataByViewer` (or
an equivalent viewer-filtered lookup) and the page is not returned, **default
to responding with a single, uniform 404** — do not compute
`meta.isForbidden` into a `403 : 404` branch that reaches the client, unless
you have verified a concrete reason to.

```javascript
// ❌ DEFAULT WRONG: leaks "this page exists" to a caller who cannot view it
return res.apiv3Err(
  new ErrorV3(`Page '${pageId}' is not found or forbidden`, 'notfound_or_forbidden'),
  meta.isForbidden ? 403 : 404,
);

// ✅ DEFAULT CORRECT: uniform response, no existence signal
return res.apiv3Err(
  new ErrorV3(`Page '${pageId}' is not found or forbidden`, 'notfound_or_forbidden'),
  404,
);
```

## Why

An authenticated user who lacks permission to view a page can still call any
apiv3 route with that page's id — the auth check that gates the route is "is
this user logged in / not read-only", not "can this user see this page".
This holds for a GET route exactly as much as a POST/PUT/DELETE one. If the
route's response distinguishes 403 (exists, forbidden) from 404 (does not
exist), that authenticated-but-unauthorized caller can probe arbitrary page
ids and learn which private pages exist, one probe at a time — a classic
existence-oracle / enumeration leak (the same class of problem as a login
form that says "wrong password" instead of "no such user").

This was found while reviewing PR #11753 (`/pages/duplicate`), which copied
the `meta.isForbidden ? 403 : 404` pattern from PR #11615 (`/pages/rename`).
In both cases, verification showed the distinction serves no purpose:

- **Server-side processing is identical either way.** Neither route does
  anything different for "forbidden" vs "not found" beyond picking the
  status number — both cases abort with no further action.
- **The client does not consume the status code.** Both `PageDuplicateModal`
  and `PageRenameModal` hand the error straight to `ApiErrorMessageList`,
  which switches on the error **code** (`notfound_or_forbidden`), not the
  HTTP status — so 403 and 404 render the exact same message either way.

So the 403/404 split was pure information disclosure with zero offsetting
benefit on these two routes. PR #11615's original diagnosis — that returning
401 was semantically wrong — was correct; the fix should have collapsed to a
uniform 404, not introduced a distinguishable 403/404.

GROWI's own broader design already treats page existence as sensitive for
some read paths: search, page listing, and `/page/exist` all use
viewer-filtered queries so an unauthorized user gets a plain "not found"
experience with no separate "forbidden" signal. But other GET routes —
`get-page-info.ts`, `respond-with-single-page.ts`, `page/export` — do the
opposite, distinguishing 403 from 404 the same way the write routes did.
Those are not a deliberate, differently-reasoned design; they are the same
violation this rule fixes, just not yet fixed (see Known cases below). This
rule states the policy for every apiv3 JSON response, not only the routes
already fixed.

## Before distinguishing 403 from 404 on an apiv3 route

The presence of `meta.isForbidden` is not, by itself, justification. Verify
both of the following before returning a distinguishable status, and record
which one justified it in a comment at the call site:

1. **Server-side behavior actually differs** between the forbidden and
   not-found cases (not just the status number) — e.g. the route logs
   differently, retries, or takes a different follow-up action that depends
   on the distinction.
2. **A real client consumer branches on the HTTP status** (not just the
   error `code`/`message`) and needs the distinction to behave correctly.

If neither holds, use a uniform 404.

## Known cases

Found via `grep -rn isForbidden apps/app/src/server/routes/apiv3` while
writing this rule.

Fixed (uniform 404):

- `apps/app/src/server/routes/apiv3/pages/index.js` — `/pages/rename`
  (previously `meta.isForbidden ? 403 : 404`).
- `apps/app/src/server/routes/apiv3/pages/index.js` — `/pages/resume-rename`
  (previously always returned 403, even when the page was genuinely not
  found — the fix collapsed this to a uniform 404, not the inverse split).
- `apps/app/src/server/routes/apiv3/share-links.js` — `DELETE
  /share-links/:id` (previously skipped the permission check entirely once
  an existence probe showed the related page was already gone, letting any
  non-admin delete the share link; now denies uniformly whenever the
  viewer-filtered lookup returns null).

Pending, intentionally left to its own PR:

- `apps/app/src/server/routes/apiv3/pages/index.js` — `/pages/duplicate`
  currently computes `meta.isForbidden ? 403 : 404` (PR #11753) on top of a
  pre-existing crash (`page.path` dereferenced before the null check, under
  `security:disableUserPages`). Left out of the PR that fixed the three
  cases above so as not to collide with #11753 already being open against
  this same route — that PR should fix both the crash and the 403/404 split
  itself, per this rule.

Pending, not yet scheduled — same violation, GET routes (found during the
same review, not fixed by any PR yet):

- `apps/app/src/server/routes/apiv3/page/get-page-info.ts` — `GET
  /page/info`, `meta.isForbidden ? 403 : 404`, pinned by an existing test
  (`get-page-info.integ.ts`) that will need updating alongside the fix.
- `apps/app/src/server/routes/apiv3/page/respond-with-single-page.ts` —
  shared by `GET /page` and `GET /page/shared`.
- `apps/app/src/server/routes/apiv3/page/index.ts` — `GET
  /page/export/:pageId`, an explicit `Page.count` probe plus
  `findByIdAndViewer`, likely the original template this pattern was copied
  from.
