// The storage layer's one contact point with the generated Prisma client
// (design.md's File Structure Plan: `db/prisma-client.ts`).
//
// Two things are deliberate here:
//
//  - **The connection URL arrives as an argument, never from `process.env`.**
//    `runtime/config.ts` is the only file in `src/` allowed to read the
//    environment, and `db/` sits inside the layer chain while `runtime/` is
//    outside it, so this factory takes the URL and the startup code passes it
//    in. (Tests are the one exception -- `*.integ.ts` reads the same env vars
//    `.env.development` documents, exactly as `postgres-connectivity.integ.ts`
//    already does.)
//  - **`DbClient` is a union of the client and a transaction handle.** Pairing
//    writes the `relation` row and its `own_key` row in one transaction
//    (design.md: 「関係の行と鍵の行を同じトランザクションで書ける」), so every
//    repository factory accepts either, and a caller can build the same
//    repository over `prisma` or over the `tx` handed to `$transaction`.

import { type Prisma, PrismaClient } from '../generated/prisma/client.js';

export type { PrismaClient };

/**
 * What a repository needs: the model delegates, present on both the client and
 * the transaction handle. Nothing here may call `$transaction` itself -- that
 * is the caller's decision, made one layer up where the unit of work is known.
 */
export type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * @param databaseUrl the app's own `DATABASE_URL` (never `CHAT_SDK_DATABASE_URL`,
 * which points at the schema `@chat-adapter/state-pg` owns).
 */
export const createPrismaClient = (databaseUrl: string): PrismaClient =>
  new PrismaClient({ datasourceUrl: databaseUrl });
