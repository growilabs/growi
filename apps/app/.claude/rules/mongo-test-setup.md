# MongoDB in Tests: Check `MONGO_URI` Before Spawning an Embedded Server

A test file that needs a real MongoDB (not a mock) must not call
`MongoMemoryServer.create()` / `MongoMemoryReplSet.create()` unconditionally.
Check `process.env.MONGO_URI` first and connect to that; only fall back to an
embedded server when it is unset. Origin: #11744, where two `.spec.ts` files
skipped this check and flaked in CI.

## Why

The `ci-app-test` job (`test:unit test:components`, see `.github/workflows/`)
already starts a real MongoDB replica set via `supercharge/mongodb-github-action`
and exports `MONGO_URI` for that job — even plain `.spec.ts` unit tests can see
it. A `beforeAll` that ignores this and calls `MongoMemoryServer.create()`
anyway spawns a second, redundant `mongod`, downloaded from `mongodb-memory-server`'s
default cache (`~/.cache/mongodb-binaries`), resolving whatever version it
picks. This is a completely different cache/version path than the project's
pinned `MONGOMS_BINARY_OPTS` (`apps/app/test/setup/mongo/utils.ts`), which the
`app-integration` project's `global-setup.ts` pre-downloads once, before any
worker starts, specifically to avoid concurrent workers racing to download the
same binary and hitting lock-file contention. An unprotected, unplanned-for
`MongoMemoryServer.create()` call reproduces exactly that race, and was the
direct cause of #11744's `beforeAll` timeout flake.

## Which shape applies depends on the Vitest project, not on "mocked vs real"

`vitest.workspace.mts` routes `**/*.spec.{ts,js}` to `app-unit` (no Mongo
setupFiles) and `**/*.integ.ts` to `app-integration` (has the shared
`test/setup/mongo/index.ts` setupFile + global-setup pre-download). The
`.spec.ts` vs `.integ.ts` choice is about whether a file needs the
integration project's shared harness (Crowi wiring, Elasticsearch,
migrate-mongo, and — critically — a **shared per-worker mongoose connection**
that persists across files). It is not about whether the file is allowed to
talk to a real database: a `.spec.ts` file can connect to a real embedded or
external Mongo as long as it manages that connection itself, start to finish.

### `.integ.ts` files (app-integration project)

Do not manage your own connection at all. `test/setup/mongo/index.ts` already
connects once per worker (it explicitly skips reconnecting when
`mongoose.connection.readyState === 1`) and tears down in its own `afterAll`.
Just `import mongoose` and use it once connected.

### `.spec.ts` files that need their own self-contained real Mongo

Do the `MONGO_URI` check inline, but keep the file's own connect/disconnect
lifecycle — do not rename the file to `.integ.ts` as a shortcut to inherit the
shared setup. That was considered and rejected for #11744: a self-contained
file's `afterAll` calls `dropDatabase()` + `connection.close()`, which would
tear down the shared per-worker connection out from under whichever
`.integ.ts` file runs next in the same worker, and it would also pull in
unrelated setupFiles (Elasticsearch, migrate-mongo, Prisma) the file doesn't
need.

Use `connectSelfContainedMongo` / `disconnectSelfContainedMongo`
(`test/setup/mongo/self-contained-connection.ts`) rather than writing the
`MONGO_URI` check inline — it already handles the fallback and gives the
file its own stable database name via `replaceMongoDbName`, so it can't
collide with `app-integration`'s `growi_test_${workerId}` naming
(`test/setup/mongo/test-db-config.ts`) on the same shared external MongoDB:

```ts
import type { MongoMemoryServer } from 'mongodb-memory-server-core';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

let mongod: MongoMemoryServer | undefined;

beforeAll(async () => {
  ({ mongod } = await connectSelfContainedMongo('growi_test_unit_<unique-name>'));
});

afterAll(async () => {
  await disconnectSelfContainedMongo(mongod);
});
```

Pass a name that is unique to this file (or `describe` block, if two blocks
in the same file must not share fixtures concurrently) — sequential
`describe`s in one file can safely share a name since each `afterAll` drops
the database before the next one connects.
