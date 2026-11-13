---
paths:
  - "apps/app/src/server/models/**/*.js"
  - "apps/app/src/server/models/**/*.ts"
---

# Prisma / Mongoose Migration Rules

This project is migrating Mongoose models to Prisma extensions incrementally.
The `/mongoose-to-prisma` skill owns the step-by-step migration procedure.

## Overall strategy

- Mongoose remains responsible for collection/index creation until every
  model has been migrated; only then does `prisma db push` take over.
- Mongoose statics and instance methods are replaced by `Prisma.defineExtension`.

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
