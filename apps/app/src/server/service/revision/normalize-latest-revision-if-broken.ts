import type { HydratedDocument, Types } from 'mongoose';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import { Revision } from '~/server/models/revision';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:service:revision:normalize-latest-revision',
);

const OLD_MIGRATION_FILE_NAME =
  '20211227060705-revision-path-to-page-id-schema-migration--fixed-7549';
const NEW_MIGRATION_FILE_NAME =
  '20211227060705-revision-path-to-page-id-schema-migration--fixed-8998';

let cachedAppliedAt: Date | null | undefined;
let cachedIsAffected: boolean | undefined;

/**
 * Reset the cache for testing purposes.
 * @internal This function is only for testing.
 */
export const __resetCacheForTesting = (): void => {
  cachedAppliedAt = undefined;
  cachedIsAffected = undefined;
};

/**
 * Check if this instance went through the problematic migration (v6.1.0 - v7.0.15).
 *
 * Condition logic:
 * - If old migration (fixed-7549) does NOT exist AND new migration (fixed-8998) exists
 *   → Return false (fresh installation, not affected)
 * - If old migration (fixed-7549) exists
 *   → Return true (went through problematic version, affected)
 * - If neither migration exists
 *   → Log warning and return false (not affected)
 *
 * @returns true if affected by the problematic migration, false otherwise
 *
 * @see https://dev.growi.org/69301054963f68dfcf2b7111
 */
const isAffectedByProblematicMigration = async (): Promise<boolean> => {
  if (cachedIsAffected !== undefined) {
    return cachedIsAffected;
  }

  const migrationCollection = mongoose.connection.collection('migrations');

  const oldMigration = await migrationCollection.findOne({
    fileName: { $regex: `^${OLD_MIGRATION_FILE_NAME}` },
  });
  const newMigration = await migrationCollection.findOne({
    fileName: { $regex: `^${NEW_MIGRATION_FILE_NAME}` },
  });

  // Case: fresh installation (new migration only) → not affected
  if (oldMigration == null && newMigration != null) {
    cachedIsAffected = false;
    cachedAppliedAt = null;
    return false;
  }

  // Case: went through problematic version (old migration exists) → affected
  if (oldMigration != null) {
    cachedIsAffected = true;
    cachedAppliedAt = oldMigration.appliedAt;
    return true;
  }

  // Case: neither migration exists (unexpected, but handle gracefully) → not affected
  logger.warn(
    'Neither old nor new migration file found in migrations collection. This may indicate an incomplete migration state.',
  );
  cachedIsAffected = false;
  cachedAppliedAt = null;
  return false;
};

/**
 * Get the appliedAt date for filtering revisions created before the problematic migration.
 *
 * @returns appliedAt date to filter revisions, or null if no filter is needed
 *
 * @see https://dev.growi.org/69301054963f68dfcf2b7111
 */
export const getAppliedAtForRevisionFilter = async (): Promise<Date | null> => {
  await isAffectedByProblematicMigration();
  return cachedAppliedAt ?? null;
};

/**
 * Normalize the latest revision which was borken by the migration script '20211227060705-revision-path-to-page-id-schema-migration--fixed-7549.js' provided by v6.1.0 - v7.0.15
 *
 * @ref https://github.com/growilabs/growi/pull/8998
 */
export const normalizeLatestRevisionIfBroken = async (
  pageId: string | Types.ObjectId,
): Promise<void> => {
  // Skip if not affected by the problematic migration
  if (!(await isAffectedByProblematicMigration())) {
    return;
  }

  if (await Revision.exists({ pageId: { $eq: pageId } })) {
    return;
  }

  logger.info(
    `The page ('${pageId}') does not have any revisions. Normalization of the latest revision will be started.`,
  );

  const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
    'Page',
  );
  const page = await Page.findOne(
    { _id: { $eq: pageId } },
    { revision: 1 },
  ).exec();

  if (page == null) {
    logger.warn(
      `Normalization has been canceled since the page ('${pageId}') could not be found.`,
    );
    return;
  }
  if (
    page.revision == null ||
    !(await Revision.exists({ _id: page.revision }))
  ) {
    logger.warn(
      `Normalization has been canceled since the Page.revision of the page ('${pageId}') could not be found.`,
    );
    return;
  }

  // update Revision.pageId
  await Revision.updateOne({ _id: page.revision }, { $set: { pageId } }).exec();
};
