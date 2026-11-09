---
paths:
  - "apps/app/src/server/models/**/*.js"
  - "apps/app/src/server/models/**/*.ts"
---

# Prisma / Mongoose Migration Rules

This project is migrating Mongoose models to Prisma extensions incrementally.
The `/mongoose-to-prisma` skill owns the step-by-step migration procedure.

## Overall strategy

- Mongoose statics and instance methods are replaced by `Prisma.defineExtension`.

## Indexes

- **Create every new index with a `migrate-mongo` migration**
  (`collection.createIndex(...)`, which is a no-op when the same index already
  exists), and declare it in `schema.prisma` as `@@index` / `@@unique` with the
  same `map:` name. Do not add it to a Mongoose schema (`index: true`,
  `schema.index(...)`).
- Why: deploy never runs `prisma db push`, so `schema.prisma`'s index
  attributes create nothing. An index that only a Mongoose schema declares
  silently stops being created once that schema is removed — new installs then
  run without it, and no test notices. A migration keeps working whichever ORM
  remains. Precedent:
  `apps/app/src/migrations/20260619120000-add-unique-key-index-to-auditlog-es-sync-collections.js`.
- Indexes already declared in a Mongoose schema stay there for now. Before a
  Mongoose schema file is deleted, move each of its indexes into a migration
  first (see the `/mongoose-to-prisma` skill).

## `_id` / `__v`

- Prisma disallows column names starting with `_`, so `schema.prisma` declares
  them as `id` / `v` with `@map("_id")` / `@map("__v")`.
- `createPrisma()` in `apps/app/src/utils/prisma.ts` provides a global
  `$allModels` compute for both fields, typed `any` (`@ts-ignore`).
- Each per-model extension additionally declares `result.<collection>._id`
  and/or `__v` for whichever of the two that model actually has. This gives
  the field a real type and takes precedence over the `$allModels` fallback.
  A model declared with `{ _id: false }` or `{ versionKey: false }` has no
  alias for the missing one.

## `__v` behavior

- Mongoose incremented `__v` only on specific operations (array field
  modifications via `$push`/`$pull`, etc.). Prisma's `$extends` query
  middleware increments `v` on every `update`/`updateMany` call. Code or
  tests that assert a specific `__v` value after a partial update are relying
  on behavior that no longer holds.
