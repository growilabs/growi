# Page Write-Action Responses Must Not Leak Existence (403 vs 404)

Scope: **write/mutation** apiv3 routes under `apps/app/src/server/routes/apiv3`
that act on a page identified by `pageId`/`path` (duplicate, rename,
resume-rename, delete, and similar). This rule does **not** cover the normal
page-viewing path (`src/pages/[[...path]]/**`, `respond-with-single-page.ts`,
`get-page-info.ts`) — that surface still distinguishes forbidden from
not-found today, and changing it is a separate, larger decision that has not
been made yet.

## The rule

When a write-action route looks up its target page via
`findPageAndMetaDataByViewer` (or an equivalent viewer-filtered lookup) and
the page is not returned, **default to responding with a single, uniform
404** — do not compute `meta.isForbidden` into a `403 : 404` branch that
reaches the client, unless you have verified a concrete reason to.

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

An authenticated user who lacks permission to view a page can still call a
write-action route with that page's id — the auth check that gates the route
is "is this user logged in / not read-only", not "can this user see this
page". If the route's response distinguishes 403 (exists, forbidden) from
404 (does not exist), that authenticated-but-unauthorized caller can probe
arbitrary page ids and learn which private pages exist, one probe at a time —
a classic existence-oracle / enumeration leak (the same class of problem as a
login form that says "wrong password" instead of "no such user").

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
*read* paths: search, page listing, and `/page/exist` all use viewer-filtered
queries so an unauthorized user gets a plain "not found" experience with no
separate "forbidden" signal. This rule brings write-action routes in line
with that same posture, rather than deciding it per-route each time.

## Before distinguishing 403 from 404 on a write-action route

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
