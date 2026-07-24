# Activity Recording (order-sensitive middleware & emit)

Non-GET apiv3 routes record an audit `Activity` through a two-part mechanism that
is **order-sensitive in two independent ways**. Both are easy to get wrong and
the failure is silent (a wrong, missing, or extra audit row), so follow this
rule instead of re-deriving it per route. Mechanism details and rationale live in
`.kiro/specs/activity-log/design.md`.

## How it works (context)

`middlewares/add-activity.ts`, at request arrival, mints an `activityId`, stashes
the request context `{ ip, endpoint, userId, username, createdAt }` in the
process-local `pendingActivityContext` map, sets `res.locals.activity`, and
registers `registerFailsafeFinalizer(res, id, ctx)`. That finalizer, on the
response's `finish`/`close`, records exactly one `ACTION_UNSETTLED` "an attempt
was made" row when the response failed (`statusCode >= 400`) or the client
disconnected mid-response (`writableFinished === false`), then clears the map
entry. The real action is recorded separately: a route calls
`activityEvent.emit('update', res.locals.activity._id, ...)`, and the `update`
listener (`service/activity.ts`) takes the context **synchronously** (before any
`await`) and settles the row from it.

## Rule 1 — emit the activity BEFORE the response is sent

The listener's synchronous `pendingActivityContext.take()` must run before the
response's `finish` clears the context; otherwise the row settles with
`user: null` — a "bare" activity that has broken the notification list (#11510)
and dropped the operator from audit rows.

- The emit (and any code the emit depends on) must run **before `res.apiv3()`**,
  with **no `await` between `res.apiv3()` and the emit**. If deciding whether to
  emit needs an `await` (e.g. a DB check), do that await before the response too
  — see `routes/apiv3/page/update-page.ts` (`generateUpdateActivity`). A bare
  emit right after `res.apiv3()` with no await happens to be safe but is fragile;
  put it before the response anyway — see `routes/apiv3/page/create-page.ts`.
- If the activity genuinely must be emitted **after** the response (work that
  streams progress over WebSocket, e.g. data import), capture the context before
  responding and re-arm it right before the emit: `pendingActivityContext.take()`
  before `res.apiv3()`, then `pendingActivityContext.set()` immediately before
  the emit — see `routes/apiv3/import.ts` + `import-executor.ts`. Alternatively
  manage the context yourself without the middleware finalizer — see
  `service/page/index.ts` (`revertDeletedPage`).
- Listener side (do not change): take the context before any `await`.

Ship a drift test: an integration test asserting the settled row keeps its
operator even when the response finishes immediately (see
`page/update-page.integ.ts`, `page/create-page.integ.ts`,
`import-executor.integ.ts`).

## Rule 2 — put `addActivity` after auth, before the validators

Where a failing middleware sits relative to `addActivity` decides whether a
failed request is audited:

- **Before `addActivity` → not recorded.** Authentication / authorization checks
  (`accessTokenParser`, `loginRequired*` / `adminRequired`, `excludeReadOnlyUser`)
  run **before** `addActivity`, so a 401/403 from them leaves no activity row. We
  do not audit requests that have no authenticated operator (login attempts are
  recorded separately via the login-activity path).
- **After `addActivity` → recorded as `ACTION_UNSETTLED`.** Input validation
  (`apiV3FormValidator` and its `body(...)` chain) and the handler's own error
  responses (400 / 404 / 409 / 5xx) run **after** `addActivity`, so a failed
  attempt by an authenticated operator is audited.

Canonical order for a recording (non-GET) route:

```
accessTokenParser(...),
loginRequiredStrictly / adminRequired,
excludeReadOnlyUser,     // authz: before addActivity (a rejected write is NOT audited)
addActivity,             // mint id + stash context + register finalizer
...body(...) validators,
apiV3FormValidator,      // after addActivity: validation failures ARE audited
handler,                 // its own 4xx/5xx are also audited as ACTION_UNSETTLED
```

Project policy behind this: a validation failure by an authenticated operator IS
worth an attempt record; an authentication failure is NOT. So **do not place
`apiV3FormValidator` before `addActivity`**.

> Some routes predate this rule and still order `apiV3FormValidator` before
> `addActivity` (their validation failures are silently not audited). Migrating
> them to the canonical order is a separate, tracked change.

## Call-site comments

The "why" lives in this file. A call site needs only a short pointer comment
(e.g. `// emit before res.apiv3() — see rules/activity-recording.md`), not a
paragraph re-explaining the context lifecycle.
