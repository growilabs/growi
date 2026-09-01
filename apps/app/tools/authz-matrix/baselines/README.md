# apiv3 Authorization Baselines

Committed snapshots of the authorization surface, used to prove that a refactor did not
move it. Re-capture, then `git diff` these files.

| File | Captured by | Content |
|---|---|---|
| `route-middleware.json` | `pnpm run authz:capture-routes` | `(method, path, middlewares[])` for every apiv3 leaf route |
| `authz-matrix.json` | `pnpm run authz:capture-matrix` | HTTP status per endpoint × {unauthenticated, guest, readonly, admin} |
| `ws-authz.json` | `pnpm run authz:capture-ws` | `/yjs/<pageId>` and socket.io connect outcomes for 3 session cases each |

Only the `entries` / `matrix` arrays are signal — the `capturedAt` / `git` / `node`
envelope fields change on every run. A capture needs a reachable MongoDB and a free port.

**These files are a historical reference, not a live gate.** They were captured on
2026-06-12 (`447ddd20ad`) during the ESM migration and the apiv3 surface has moved since,
so diffing today's code straight against them is noise. The way to use the tools is to
capture a *fresh* "before" on your own base commit, apply the change, capture "after", and
diff those two. Refresh the committed files only when you deliberately want a new reference
point — `authz-matrix` and `ws-authz` captures seed fixture users (and pages) into the
target database, so run them against a scratch DB, not one you care about.

Full procedure, guarantees and coverage limits: the **Authorization Regression Check**
section of `apps/app/.claude/skills/app-commands/SKILL.md`.
