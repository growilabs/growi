import { Prisma } from '~/generated/prisma/client';
import type { prisma } from '~/utils/prisma';

import type { ModelCatalog } from '../services/ai-sdk-modules/build-model-catalog';

const SINGLETON_ID = 'singleton';

/**
 * The persisted result of an opt-in model-catalog refresh (Req 9): the
 * models.dev snapshot fetched at runtime, run through the SAME filter and
 * sanity checks as the bundled asset (buildModelCatalog), stored so it
 * survives restarts and is shared across app instances.
 *
 * The effective catalog resolution is "refreshed (this document) if present,
 * otherwise the bundled committed asset" (Req 9.5) — deleting the document
 * simply falls back to the bundled catalog.
 *
 * Prisma-first model (no Mongoose counterpart): the collection is brand new,
 * has no secondary indexes, and is created lazily by MongoDB on the first
 * upsert, so there is no Mongoose schema to keep for index management. The
 * collection lives in `schema.prisma` as `mastrarefreshedmodelcatalogs`
 * (@@map("mastra_refreshed_model_catalog")).
 */
export interface IRefreshedModelCatalog {
  /** provider → selectable model ids (same shape/filter as the bundled catalog). */
  models: ModelCatalog;
  /** When the snapshot was fetched from models.dev. */
  fetchedAt: Date;
  /** Upstream attribution (mirrors the bundled asset's `_source`). */
  source: string;
}

export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      mastrarefreshedmodelcatalogs: {
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
      mastrarefreshedmodelcatalogs: {
        /**
         * The persisted snapshot, or null when no refresh has ever succeeded
         * (the caller then falls back to the bundled catalog — Req 9.5).
         */
        async getSingleton(): Promise<IRefreshedModelCatalog | null> {
          const context =
            Prisma.getExtensionContext<
              typeof prisma.mastrarefreshedmodelcatalogs
            >(this);

          const doc = await context.findUnique({
            where: { id: SINGLETON_ID },
          });
          if (doc == null) {
            return null;
          }

          return {
            // Stored as Json; every write goes through buildModelCatalog
            // validation first (upsertSingleton below), so the persisted shape
            // is always a validated ModelCatalog.
            models: doc.models as ModelCatalog,
            fetchedAt: doc.fetchedAt,
            source: doc.source,
          };
        },

        /** Create-or-replace the singleton with a freshly validated snapshot. */
        async upsertSingleton(snapshot: IRefreshedModelCatalog): Promise<void> {
          const context =
            Prisma.getExtensionContext<
              typeof prisma.mastrarefreshedmodelcatalogs
            >(this);

          await context.upsert({
            where: { id: SINGLETON_ID },
            create: { id: SINGLETON_ID, ...snapshot },
            update: { ...snapshot },
          });
        },
      },
    },
  });
});
