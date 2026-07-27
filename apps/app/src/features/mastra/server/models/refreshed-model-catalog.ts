import { Prisma } from '~/generated/prisma/client';
import loggerFactory from '~/utils/logger';
import type { prisma } from '~/utils/prisma';

import {
  type ModelCatalog,
  persistedModelCatalogSchema,
} from '../services/ai-sdk-modules/build-model-catalog';

const logger = loggerFactory(
  'growi:features:mastra:models:refreshed-model-catalog',
);

const SINGLETON_ID = 'singleton';

/**
 * The persisted result of an opt-in model-catalog refresh (Req 9): the
 * models.dev snapshot fetched at runtime, run through the SAME filter and
 * sanity checks as the bundled asset (buildModelCatalog), stored so it
 * survives restarts and is shared across app instances.
 *
 * The effective catalog resolution picks the NEWER of this document and the
 * bundled committed asset (Req 9.5): the refreshed snapshot wins unless the
 * image now bundles a strictly newer catalog generation than the one that was
 * current when the refresh ran (see effective-model-catalog.ts). Deleting the
 * document simply falls back to the bundled catalog.
 *
 * Prisma-first model (no Mongoose counterpart): the collection is brand new,
 * has no secondary indexes, and is created lazily by MongoDB on the first
 * upsert, so there is no Mongoose schema to keep for index management. The
 * collection lives in `schema.prisma` as `mastrarefreshedmodelcatalogs`
 * (@@map("mastra_refreshed_model_catalog")).
 */
export interface IRefreshedModelCatalog {
  /** provider → selectable models (id + display name; same shape/filter as the bundled catalog). */
  models: ModelCatalog;
  /** When the snapshot was fetched from models.dev (server clock; informational). */
  fetchedAt: Date;
  /**
   * `_generatedAt` of the bundled asset that was current when this snapshot
   * was fetched. The newer-wins resolution (Req 9.5) compares this against the
   * CURRENT bundled `_generatedAt`, so both operands come from the vendoring
   * machine's clock — comparing the server-clock `fetchedAt` against the
   * CI-clock `_generatedAt` would let server clock skew silently shadow a
   * successful refresh behind the bundled catalog.
   */
  supersededBundledGeneratedAt: Date;
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
         * OR the stored document does not validate (the caller then falls
         * back to the bundled catalog — Req 9.5).
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

          // Read-side validation: every write goes through buildModelCatalog
          // first, but the stored Json is only as trustworthy as the code
          // version that wrote it (rolling upgrades share one MongoDB, and
          // operators can edit documents). A non-validating snapshot is
          // treated like an absent one instead of crashing every read.
          const parsed = persistedModelCatalogSchema.safeParse(doc.models);
          if (!parsed.success) {
            logger.warn(
              { err: parsed.error },
              'Ignoring the persisted model-catalog snapshot: its `models` field does not match the expected shape. ' +
                'The bundled catalog will be served; run a catalog refresh (or delete the mastra_refreshed_model_catalog document) to repair.',
            );
            return null;
          }

          const models: ModelCatalog = parsed.data;
          return {
            models,
            fetchedAt: doc.fetchedAt,
            supersededBundledGeneratedAt: doc.supersededBundledGeneratedAt,
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
