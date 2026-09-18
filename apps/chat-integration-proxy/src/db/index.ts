// Public barrel for `db/` -- the only import point other layers use
// (design.md's declared dependency order:
// `types -> capabilities -> db -> platform -> command -> relation -> growi
// -> orchestration -> routes`). Task 2.3's job.
//
// Re-exports everything from `db/repositories/`, plus the two things a caller
// needs directly from this layer to construct a repository at all:
// `createPrismaClient` (builds the `PrismaClient` a repository factory takes
// as its `db` argument) and the `DbClient`/`PrismaClient` types the factory
// functions are typed against.
//
// `Prisma` itself (the generated namespace, e.g. `Prisma.TransactionClient`)
// is deliberately NOT re-exported here: nothing outside `db/` needs to name a
// transaction handle's type directly, and re-exporting it would let a caller
// reach for `src/generated/prisma/client.js` types beyond what `DbClient`
// already exposes -- the same reasoning `capabilities/index.ts` gives for
// leaving `CapabilityLevel` to its own owning module.

export type { DbClient, PrismaClient } from './prisma-client.js';
export { createPrismaClient } from './prisma-client.js';
// The one composed sequence this layer publishes rather than a single-table
// primitive: removing one relation touches six repositories in a fixed order,
// and it has callers in two different layers (`platform/` and `relation/`).
// See the file's own header for why it lives here and not in `relation/`.
export type { RelationCascadeRepositories } from './relation-cascade.js';
export { deleteRelationCascade } from './relation-cascade.js';
export * from './repositories/index.js';
