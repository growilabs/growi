---
name: mongoose-to-prisma
description: Migrate a single Mongoose model file to Prisma, following GROWI's established patterns. Step-by-step with human approval at each stage.
argument-hint: <path-to-mongoose-model>
allowed-tools: Read, Bash, Edit, Write, Grep
---

# mongoose-to-prisma Skill

## Purpose

Guide the developer through migrating one Mongoose model file to use Prisma extensions, following GROWI's established migration patterns. Human approves each step before proceeding.

Invoke with the path to a Mongoose model file:

```
/mongoose-to-prisma apps/app/src/server/models/tag.ts
```

If no path is given, ask for one before starting.

---

## Background: GROWI Migration Strategy

GROWI migrates Mongoose → Prisma incrementally, one model at a time:

- **Mongoose is kept** for collection and index creation until ALL models have migrated (then `prisma db push` takes over)
- **Prisma extensions** (`Prisma.defineExtension`) replace Mongoose statics and instance methods
- **No breaking API changes** — frontend is out of scope; method signatures must remain backward-compatible
- `_id` and `__v` backward-compat fields are provided by `createPrisma()` in `apps/app/src/utils/prisma.ts` as computed fields; callers accessing `doc._id` or `doc.__v` require no changes
- Prisma does not support column names beginning with `_`, so they are declared as `id`/`v` with `@map("_id")`/`@map("__v")` aliases in `schema.prisma`

Key reference files (read these at the start of each invocation to get current patterns):
- `apps/app/src/server/models/external-account.ts` — TS model: Prisma extension added in the same file after the Mongoose schema block
- `apps/app/src/server/models/user/index.prisma.ts` — JS model: separate `.prisma.ts` file because the base model is `.js`
- `apps/app/prisma/schema.prisma` — Prisma schema for MongoDB
- `apps/app/src/utils/prisma.ts` — `createPrisma()` with `_id`/`__v` computed fields and `v` auto-increment on every update

---

## Step 0: Startup Summary

Before Step 1, read the target file and `apps/app/prisma/schema.prisma`, then print:

```
Target: <path>
Collection: <collection name (lowercase plural from schema or inferred)>
Schema fields: <field list>
Statics: <method names>
Virtuals: <virtual names, or none>
TypeScript interfaces: <interfaces found>
Plugins: <mongoose plugins used>
Hooks: <pre/post hooks if any, else none>
Factory pattern: <yes/no>
schema.prisma: ✅ model entry found / ❌ not found
Already partially migrated: ✅ YES (Prisma extension exists at line N) / ❌ NO
Estimated size: small / medium / large
```

Ready to start?

Wait for confirmation before proceeding.

---

## Step 1: Analysis

Read the target Mongoose model file in full and extract:

1. **Schema fields** — name, type, required/optional, unique, index, sparse
2. **`_id` / `__v` presence** — check the Schema options argument for `{ _id: false }` and/or `{ versionKey: false }`. Both default to enabled in Mongoose when unset, but either can be individually disabled — note which of `_id`/`__v` actually exist on this model (could be both, either one, or neither)
3. **Statics** — each method name and TypeScript signature
4. **Instance methods** — each method name and signature (if any)
5. **Virtuals** — each `schema.virtual('name').get(fn)` (and `.set(fn)` if present): the virtual's name, the getter's return type, and every schema field it reads inside the getter body (these become the `needs` for its Prisma `result` compute alias in Step 3)
6. **Plugins** — `mongoose-paginate-v2`, `mongoose-unique-validator`, others
7. **Relations** — fields with `ref: 'Model'`, their names
8. **Factory pattern** — does the file export `const factory = (crowi: Crowi) => { ... }` or similar?
9. **Hooks** — any `schema.pre()`/`schema.post()` calls?
10. **Already partially migrated?** — is a `Prisma.defineExtension` already present?
11. **Callers** — run all four (alias path AND relative path, both extensions):
   ```bash
   grep -r "from '~/server/models/<model-name>'" apps/app/src --include="*.ts" -l
   grep -r "from '~/server/models/<model-name>'" apps/app/src --include="*.js" -l
   grep -r "from './<model-name>'" apps/app/src --include="*.ts" -l
   grep -r "from './<model-name>'" apps/app/src --include="*.js" -l
   ```

Present a structured summary of findings.

Ask: **"Proceed to Step 2?"**

---

## Step 2: schema.prisma Verification

Read `apps/app/prisma/schema.prisma` and check for the collection entry (use lowercase plural name, e.g. `tags` for `Tag`):

1. **Does the collection model exist?** If not, it must be added before Step 3.
2. **Do all Mongoose schema fields have a corresponding Prisma field?** List any missing fields.
3. **`_id` and `__v` mapping**: verify the model has:
   - `id String @id @default(auto()) @map("_id") @db.ObjectId`
   - `v  Int    @map("__v")`
4. **Relations**: verify each relation field uses `onDelete: NoAction, onUpdate: NoAction`.
   Mongoose has no referential integrity enforcement; this is the Mongoose-compatible default.
5. **Sparse index check**: if the Mongoose schema declares `{ sparse: true }` on any index, flag it:
   > ⚠️ Prisma does not support sparse indexes. Create the index directly via a `migrate-mongo` migration using the native MongoDB driver (`collection.createIndex({ ... }, { sparse: true })`), following the precedent in `apps/app/src/migrations/20220411114257-set-sparse-option-to-slack-member-id.js`. A sparse index is a database-level property, independent of Mongoose/Prisma — once created this way it keeps applying to every write (Mongoose or Prisma) and survives the eventual full removal of Mongoose. Add a comment in `schema.prisma` noting the index is sparse and managed by a migration, not by Prisma, so a future `prisma db push` doesn't attempt to recreate it without the sparse flag.

   Show the proposed migration file before writing. Wait for approval before proceeding.

If `schema.prisma` needs changes, show a diff of the proposed additions and wait for approval before writing.

If no changes needed: note "No changes to schema.prisma" and continue.

Ask: **"Proceed to Step 3?"**

---

## Step 3: Prisma Extension Generation

Generate a Prisma extension that replaces all Mongoose statics (and instance methods if any).

**Choose output location:**
- Source is a `.ts` file → append the extension at the **bottom of the same file** after the Mongoose schema block (follow `external-account.ts` pattern)
- Source is a `.js` file → create a new `<model-name>.prisma.ts` file alongside it (follow `user/index.prisma.ts` pattern)

**Skeleton pattern** (from `external-account.ts`):

```typescript
import { Prisma } from '~/generated/prisma/client';
import type { prisma } from '~/utils/prisma';
// import other types as needed

export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      <collection>: {
        // include only the fields confirmed present in Step 1 — see note below
        // for backward compatibility with mongoose
        _id: {
          needs: { id: true },
          compute(model) {
            return model.id;
          },
        },
        // for backward compatibility with mongoose
        __v: {
          needs: { v: true },
          compute(model) {
            return model.v;
          },
        },
      },
    },
    model: {
      <collection>: {
        async <methodName>(<params>): Promise<ReturnType> {
          const context = Prisma.getExtensionContext<typeof prisma.<collection>>(this);
          // implementation using context.findMany(), context.count(), etc.
        },
      },
    },
  });
});
```

**`_id` / `__v` result aliases — only for fields confirmed present in Step 1:**

Declare `result.<collection>._id` and/or `result.<collection>.__v` in the per-model extension **only for the field(s) Step 1 confirmed exist on this model** — not blindly for both. Most models have both (Mongoose enables `_id` and `versionKey` by default), but a model declared with `{ _id: false }` or `{ versionKey: false }` has only one or neither; do not declare an alias for a field the model never had. Omit the whole `result: { <collection>: { ... } }` block if neither applies.

This declaration is needed in the per-model extension, not only the global `$allModels` fallback in `apps/app/src/utils/prisma.ts`: the global fallback uses `// @ts-ignore` because `$allModels` cannot know any specific model's shape, so the computed `_id`/`__v` it produces are typed `any` for every model. Declaring the same field(s) again here — scoped to `<collection>` — gives them their real type (`string`/`number`) because the result extension knows the concrete model shape, and this model-specific declaration takes precedence over the `$allModels` one once `.$extends(<thisModel>Extension)` is chained after it in `utils/prisma.ts`. Skipping this for a field the model actually has leaves it typed `any` for every caller of this collection.

**Virtual fields → `result` compute aliases:**

For each virtual found in Step 1, port the getter's logic into a `result.<collection>.<virtualName>` field in the same extension, alongside `_id`/`__v`. `needs` must list every schema field the getter body reads; `compute` runs the same logic against the Prisma model shape:

```typescript
// Before (Mongoose)
schema.virtual('isDeleted').get(function(this: FooDocument) {
  return this.deletedAt != null;
});

// After (Prisma) — inside the same result.<collection> block as _id/__v
result: {
  <collection>: {
    // ...,
    isDeleted: {
      needs: { deletedAt: true },
      compute(model) {
        return model.deletedAt != null;
      },
    },
  },
},
```

If the getter calls other instance methods or reads fields through populated relations, resolve those dependencies first — `needs` can only reference scalar fields on the same model, not populated relation documents. If a virtual cannot be expressed as a pure function of the model's own scalar fields (e.g. it queries another collection), flag it and discuss an alternative (a Prisma extension `model` method instead of a `result` field) with the developer rather than forcing it into `compute`.

Once ported here, the original `schema.virtual(...)` block is deleted in Step 6 — see the cleanup table.

**Converting Mongoose statics to Prisma:**
- `Model.find({ ... })` → `context.findMany({ where: { ... } })`
- `Model.findOne({ ... })` → `context.findUnique({ where: { ... } })` when the filter uses a unique field or compound unique index (verifiable from `schema.prisma`); otherwise `context.findFirst({ where: { ... } })`. Prefer `findUnique` wherever possible.
- `Model.countDocuments({ ... })` → `context.count({ where: { ... } })`
- `Model.aggregate([...])` → keep as a raw aggregation via `client.$runCommandRaw()` if complex, or rewrite with Prisma groupBy
- `Model.insertMany([...])` → `context.createMany({ data: [...] })`
- `Model.updateMany({ ... }, { ... })` → `context.updateMany({ where: { ... }, data: { ... } })`
- ObjectId strings: Prisma uses `String` for ObjectId fields; use `.toString()` when comparing with `Types.ObjectId` values from callers

**Plugin replacements:**
- `mongoose-paginate-v2` → use the `paginate` model method already defined on `$allModels` in `apps/app/src/utils/prisma.ts` — do not hand-roll `findMany`/`count`. Call it as `context.paginate({ where, orderBy, include, select, page, limit })`; it returns a `mongoose-paginate-v2`-compatible shape (`docs`, `totalDocs`, `limit`, `page`, `pagingCounter`, `totalPages`, `hasNextPage`, `hasPrevPage`, `nextPage`, `prevPage`), so callers that destructure those fields from the old `Model.paginate(...)` result need no further changes.
- `mongoose-unique-validator` → already handled by `@unique` in `schema.prisma`; the developer should catch Prisma error code `P2002` where unique constraint errors are currently caught.

**Hook migration:**
If `schema.pre()`/`schema.post()` hooks exist, convert to `$extends` query middleware:
```typescript
query: {
  <collection>: {
    async create({ args, query }) {
      // pre-save logic
      const result = await query(args);
      // post-save logic
      return result;
    },
  },
},
```

**Factory pattern:**
If the model uses `const factory = (crowi: Crowi) => { ... }`, the goal is to avoid passing `crowi` as a closure parameter into `Prisma.defineExtension` — `createPrisma()` in `apps/app/src/utils/prisma.ts` currently takes no arguments, so there is no established pattern for injecting `crowi` itself into the Prisma client chain.

Before generating code, investigate what the factory actually uses `crowi` for (typically `crowi.events.<event>.emit(...)`, but verify per model — it may be something else):
1. Open the dependency behind `crowi.<path>` (e.g. the event class behind `crowi.events.<event>`) and read its implementation, not just its usage site in the model file.
2. Check whether that dependency reads `this.crowi`/needs live access to the `Crowi` instance anywhere in its own methods, or whether the reference is unused dead weight.
3. Based on what you find, work out the smallest change that removes the closure parameter while preserving behavior — this varies per model and per dependency, so don't reach for a fixed template. Consider, as starting points, whatever fits the actual finding: hoisting the dependency to a module-level singleton (clean, but only safe if it never needs live `crowi` state), a lazily-read accessor for the `Crowi` instance (keeps the dependency untouched but still needs `crowi` available somewhere at call time), or some other shape entirely if the investigation turns up something different.
4. Present the specific approach you worked out — grounded in what step 1–2 found for this model — to the developer, with the reasoning, and wait for their decision before writing any code. Do not pick silently and do not produce a half-working implementation.

Show the full generated extension before writing. Wait for approval.

Ask: **"Proceed to Step 4?"**

---

## Step 4: Caller Update

For each caller file found in Step 1, make the following changes:

### 4-1: Replace call sites

Replace every `MongooseModel.method()` call with the Prisma equivalent.

The Mongoose model is typically imported as a default import and used directly:
```typescript
// Before (Mongoose)
import BookmarkFolder from '~/server/models/bookmark-folder';
const folder = await BookmarkFolder.createByParameters(params);
```

After migration, use `prisma` from `~/utils/prisma`:
```typescript
// After (Prisma)
import { prisma } from '~/utils/prisma';
const folder = await prisma.bookmarkfolders.createByParameters(params);
```

For each caller file:
1. Find every call to the Mongoose model's statics
2. Replace with the Prisma extension method on the matching collection
3. Update the import: remove the Mongoose model default import, add `import { prisma } from '~/utils/prisma'` if not already present

Show diffs for all caller files before writing. Ask: **"Apply caller updates?"**

### 4-2: Relation field access

In Mongoose, a relation field (e.g. `comment.page`) could be either an ObjectId or a populated Document.
In Prisma, these are always split into two fields:
- `pageId: String` — the raw ObjectId string
- `page: pages` — the populated Document (present only when queried with `include: { page: true }`)

For each relation in the model, check callers for how they access the field and list what needs to change. Confirm no change breaks the API contract (no frontend impact).

**API response remapping — IMPORTANT:**

The frontend still expects the original Mongoose field name (e.g. `owner`, `page`, `user`), not the Prisma-renamed field (`ownerId`, `pageId`, `userId`). Search every API route handler among the callers found in Step 1 (typically `server/routes/apiv3/**`) for places where a Prisma result is sent via `res.apiv3(...)` / `res.json(...)` / a serializer, and remap each renamed relation field back to its original name before responding:

```typescript
// Before (Mongoose) — field was already named `owner`
return res.apiv3({ bookmarkFolder });

// After (Prisma) — `owner` became `ownerId`; map it back for the response
return res.apiv3({
  bookmarkFolder: {
    ...bookmarkFolder,
    owner: bookmarkFolder.ownerId,
  },
});
```

This applies to every relation field that was split in Step 4-2 above (`page`/`pageId`, `user`/`userId`, `owner`/`ownerId`, `parent`/`parentId`, etc.), and to nested relations returned via `include` (e.g. `bookmark.page.creatorId` → `bookmark.page.creator`). List every response shape affected and show the diff before writing.

### 4-3: Type mapping

- `FooDocument` type → replace with the Prisma-generated `foos` type from `~/generated/prisma/client`
- `FooModel` type → remove; callers now call `prisma.<collection>.<method>()` directly

**`_id` / `__v` compatibility:** No action needed — these are computed fields in `createPrisma()`. Callers that access `doc._id` or `doc.__v` continue to work without changes.

### 4-4: `__v` behavior change — IMPORTANT

> Mongoose incremented `__v` only on specific operations (array field modifications via `$push`, `$pull`, etc.).
> Prisma increments `v` (aliased as `__v`) on **every** `update` / `updateMany` call via the `$extends` query middleware in `utils/prisma.ts`.

Ask the developer to confirm this behavioral difference is acceptable for this model, or to identify any callers/tests that assert on specific `__v` values after partial updates.

Ask: **"Proceed to Step 5?"**

---

## Step 5: Test Review

Search for `*.spec.ts` and `*.integ.ts` files related to the target model:
```bash
find apps/app/src \( -name "*.spec.ts" -o -name "*.integ.ts" \) | xargs grep -l "<ModelName>\|<collection>" 2>/dev/null
```

For each test file found:
1. List Mongoose-specific constructs (direct `Model.find()` calls, `new Model()`, `model.save()`, etc.)
2. Propose updated versions that use `prisma.<collection>.<method>()` from the Prisma client
3. Note the `__v` behavior change from Step 4 — if any test asserts on a specific `__v` value after a partial update (not an array-modifying op), flag it for review

Ask: **"Proceed to Step 6?"**

---

## Step 6: Mongoose Cleanup

Remove superseded Mongoose code from the model file now that the Prisma extension is in place and callers have been updated.

### 6-1: Classify every section

Read the file and apply the following rules to every section:

| Section | Action |
|---------|--------|
| `interface FooDocument extends Document { ... }` | **Remove** — Mongoose-specific type, no longer needed |
| `interface FooModel extends Model<FooDocument> { ... }` | **Remove** — Mongoose-specific type, no longer needed |
| Mongoose schema block (`new Schema(...)`) | **Keep** but simplify: strip type arguments (`new Schema<FooDocument, FooModel>(...)` → `new Schema(...)`) and remove the options argument (`{ toObject, timestamps, strict, ... }`) — Mongoose is only used for schema registration, not serialization |
| TODO comment above schema | **Keep** (add if missing) |
| `schema.virtual(...)` blocks | **Remove**, but only after its logic has been ported to a `result.<collection>.<virtualName>` compute alias in the Prisma extension (Step 3) — verify the alias exists before deleting |
| Mongoose statics (`schema.statics.X = ...`) | **Remove** — replaced by Prisma extension |
| `getOrCreateModel(...)` call | **Keep** the call (needed to register the schema), but **remove** the `export default` — callers now use Prisma and no longer import this model |
| `Prisma.defineExtension(...)` block | **Keep** — target state |
| Imports from `mongoose` | **Remove** any that are only used by deleted sections (e.g. `Document`, `Model`, `Types`, `HydratedDocument`) — keep `Schema` and the default `mongoose` import if still referenced by the schema block |

List the exact line ranges to delete and the modifications to make. Ask: **"Proceed?"**

### 6-2: Apply changes

Apply all deletions and modifications from 6-1 in one pass.

Show a diff of all changes before writing. Ask: **"Apply?"**

### 6-3: Verify

Run typecheck to confirm no new errors:
```bash
cd /workspace/growi && pnpm --filter @growi/app run lint:typecheck 2>&1 | grep "<model-file-name>"
```

Fix any errors that surface.

Show a completion summary:

```
✅ Migration + Cleanup Complete
Files changed:
  - <source file path> (Prisma extension + Mongoose cleanup)
  - apps/app/prisma/schema.prisma (<changed / no changes>)
  - <caller files updated>

Remaining TODOs:
  - Run pnpm prisma generate to regenerate types (if schema.prisma was changed)
  - Add .$extends(extension) to apps/app/src/utils/prisma.ts to activate the new extension
  - <source file> Mongoose schema block to be removed after all models have been migrated
  - [run the sparse-index migration created in Step 2 (if applicable)]
```

---

## Constraints

- **Do NOT** modify frontend code
- **Do NOT** run `prisma db push` or `pnpm prisma generate`
- **Do NOT** remove the Mongoose schema block (the `new Schema(...)` definition and field declarations)
- **Do NOT** handle multiple model files in one invocation — one file per `/mongoose-to-prisma` call
- **Relation default**: always use `onDelete: NoAction, onUpdate: NoAction`
