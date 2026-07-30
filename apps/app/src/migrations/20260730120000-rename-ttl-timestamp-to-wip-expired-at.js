import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:rename-ttl-timestamp-to-wip-expired-at');

const PAGES = 'pages';
const CONFIGS = 'configs';

const TTL_INDEX_NAME = 'ttlTimestamp_1';
const WIP_EXPIRED_AT_INDEX_NAME = 'wipExpiredAt_1';

/** Mirrors defaultValue of `app:wipPageExpirationSeconds` (48h). */
const DEFAULT_WIP_PAGE_EXPIRATION_SECONDS = 172800;

/**
 * Backstops a data anomaly (e.g. a parent cycle) from spinning forever. Each
 * pass can expose a new layer of empty leaves, so the loop is unbounded in
 * principle.
 */
const MAX_EMPTY_CLEANUP_PASSES = 100;

/**
 * This migration uses the raw `db` handle only — no mongoose models, no service
 * imports. A migration must keep working against the schema as it stood at this
 * point in history; importing application code that continues to evolve makes it
 * rot silently. (This is also why the empty-leaf sweep below is inlined rather
 * than shared with the runtime maintenance path.)
 */

async function dropIndexIfExists(db, collectionName, indexName) {
  const items = await db
    .listCollections({ name: collectionName }, { nameOnly: true })
    .toArray();
  if (items.length === 0) {
    return;
  }

  const collection = db.collection(collectionName);
  if (await collection.indexExists(indexName)) {
    await collection.dropIndex(indexName);
    logger.info(`Dropped index ${indexName} on ${collectionName}`);
  }
}

/**
 * The duration that the dropped TTL index used to apply via `expireAfterSeconds`.
 * Needed to convert the stored value (see the WHY block on `up`).
 */
async function resolveWipPageExpirationSeconds(db) {
  const config = await db
    .collection(CONFIGS)
    .findOne({ key: 'app:wipPageExpirationSeconds' });

  if (config?.value != null) {
    try {
      const parsed = JSON.parse(config.value);
      if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    } catch {
      logger.warn(
        'Could not parse app:wipPageExpirationSeconds - falling back to env/default',
      );
    }
  }

  const fromEnv = Number(process.env.WIP_PAGE_EXPIRATION_SECONDS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }

  return DEFAULT_WIP_PAGE_EXPIRATION_SECONDS;
}

/**
 * An empty page is a structural placeholder that only connects a real descendant
 * to its ancestors; once childless it serves no purpose. Historically the TTL
 * index deleted WIP pages without running application code, so the placeholders
 * that only hosted them were orphaned. Deleting one can leave its (also empty)
 * parent childless, so repeat until a pass removes nothing.
 */
async function removeEmptyLeafHierarchies(db) {
  const collection = db.collection(PAGES);

  let totalRemoved = 0;
  let pass = 0;

  for (; pass < MAX_EMPTY_CLEANUP_PASSES; pass++) {
    const emptyLeaves = await collection
      .aggregate([
        { $match: { isEmpty: true, path: { $ne: '/' } } },
        {
          $lookup: {
            from: PAGES,
            localField: '_id',
            foreignField: 'parent',
            pipeline: [{ $limit: 1 }, { $project: { _id: 1 } }],
            as: 'children',
          },
        },
        { $match: { children: { $size: 0 } } },
        { $project: { _id: 1 } },
      ])
      .toArray();

    if (emptyLeaves.length === 0) {
      break;
    }

    const ids = emptyLeaves.map((p) => p._id);
    const res = await collection.deleteMany({ _id: { $in: ids } });
    totalRemoved += res.deletedCount ?? 0;
  }

  if (pass >= MAX_EMPTY_CLEANUP_PASSES) {
    logger.warn(
      `Empty-leaf cleanup stopped at the ${MAX_EMPTY_CLEANUP_PASSES}-pass limit; orphaned empty pages may remain. This suggests a structural anomaly (e.g. a parent cycle).`,
    );
  }

  return totalRemoved;
}

/**
 * Migrates WIP page expiry from a MongoDB TTL index to application-driven deletion.
 *
 * WHY the field is CONVERTED, not renamed:
 *   old: `ttlTimestamp` = the moment the page was made WIP (`new Date()`), and the
 *        TTL index `ttlTimestamp_1` carried `expireAfterSeconds`, so MongoDB
 *        deleted at `ttlTimestamp + expireAfterSeconds`.
 *   new: `wipExpiredAt`  = the absolute expiry instant, computed up-front in
 *        `makeWip()` as `now + wipPageExpirationSeconds`.
 * A straight rename would leave every existing WIP page carrying a *past* instant
 * as its expiry, and the cleanup cron would delete all of them on its first run.
 * So the stored value has the configured duration added to it.
 *
 * WHY pages with descendants are exempted:
 *   `makeWip()` withholds the expiry from a page that already has children
 *   (`disableTtl`) because deleting it would orphan them — but that check only ran
 *   at creation, so legacy pages that acquired children later still carry the field.
 *   Granting them an expiry would park them permanently in the cron's "skipped,
 *   non-leaf" state. They get the legacy field dropped and no expiry, which is the
 *   state `makeWip()` would have produced had the children existed at creation.
 *
 * Ordering matters: the orphaned-empty-page sweep runs BEFORE the conversion, so
 * "has descendants" is evaluated against the cleaned tree rather than against
 * placeholders that are about to disappear.
 *
 * NOTE: this does NOT repair `descendantCount` values inflated by past TTL
 * deletions — that recount is a separate, admin-triggered maintenance operation.
 */
export async function up(db) {
  logger.info('Apply migration: ttlTimestamp -> wipExpiredAt');

  // Drop the TTL index FIRST so the TTL monitor cannot delete pages midway through.
  await dropIndexIfExists(db, PAGES, TTL_INDEX_NAME);

  const removed = await removeEmptyLeafHierarchies(db);
  logger.info(`Removed ${removed} orphaned empty page(s)`);

  const expirationSeconds = await resolveWipPageExpirationSeconds(db);
  const expirationMs = expirationSeconds * 1000;
  logger.info(
    `Converting with wipPageExpirationSeconds=${expirationSeconds} (${expirationMs} ms)`,
  );

  const collection = db.collection(PAGES);

  const legacyIds = (
    await collection
      .find({ ttlTimestamp: { $ne: null } }, { projection: { _id: 1 } })
      .toArray()
  ).map((doc) => doc._id);

  // Resolve "has descendants" from the parent links, NOT from descendantCount:
  // inflating descendantCount is precisely the corruption this PR exists to fix,
  // so the stored counter cannot be trusted here.
  const idsWithChildren = await collection.distinct('parent', {
    parent: { $in: legacyIds },
  });
  const idsWithChildrenSet = new Set(idsWithChildren.map(String));
  const expirableIds = legacyIds.filter(
    (id) => !idsWithChildrenSet.has(String(id)),
  );

  const converted = await collection.updateMany({ _id: { $in: expirableIds } }, [
    { $set: { wipExpiredAt: { $add: ['$ttlTimestamp', expirationMs] } } },
    { $unset: 'ttlTimestamp' },
  ]);
  logger.info(`Converted ${converted.modifiedCount} page(s) to wipExpiredAt`);

  // Whatever still carries the legacy field has descendants: drop it, grant no expiry.
  const exempted = await collection.updateMany(
    { ttlTimestamp: { $ne: null } },
    { $unset: { ttlTimestamp: '' } },
  );
  logger.info(
    `Exempted ${exempted.modifiedCount} page(s) with descendants from auto-expiry`,
  );

  // Dropped first so the options below are applied even when an index of this name
  // already exists with different ones: mongoose's autoIndex creates it too, and
  // MongoDB rejects a same-name index whose options differ (IndexOptionsConflict).
  // `sparse` must therefore stay in step with the schema declaration in models/page.ts.
  await dropIndexIfExists(db, PAGES, WIP_EXPIRED_AT_INDEX_NAME);
  await collection.createIndex(
    { wipExpiredAt: 1 },
    { name: WIP_EXPIRED_AT_INDEX_NAME, sparse: true },
  );

  // Recounting descendantCount is deliberately NOT done here: it is one aggregate
  // per page over the whole collection, and a boot-time migration is the wrong
  // place to stall an upgrade for an unbounded time. Instead, tell the operator —
  // but only when this instance actually carries TTL-era data, so a fresh install
  // stays silent. These counters are already computed above, so the check is free.
  const wasAffectedByTtlDeletion =
    removed > 0 || converted.modifiedCount > 0 || exempted.modifiedCount > 0;
  if (wasAffectedByTtlDeletion) {
    logger.warn(
      'This instance previously used TTL-based WIP page expiry, which deleted pages ' +
        'without running application code, so some descendantCount values may be too ' +
        'high. To correct them, enable maintenance mode and run the page tree repair ' +
        'from Admin > App Settings.',
    );
  }

  logger.info('Migration has successfully applied');
}

export async function down(db) {
  logger.info('Rollback migration: wipExpiredAt -> ttlTimestamp');

  await dropIndexIfExists(db, PAGES, WIP_EXPIRED_AT_INDEX_NAME);

  const expirationSeconds = await resolveWipPageExpirationSeconds(db);
  const expirationMs = expirationSeconds * 1000;

  const collection = db.collection(PAGES);

  const converted = await collection.updateMany({ wipExpiredAt: { $ne: null } }, [
    { $set: { ttlTimestamp: { $subtract: ['$wipExpiredAt', expirationMs] } } },
    { $unset: 'wipExpiredAt' },
  ]);
  logger.info(`Converted ${converted.modifiedCount} page(s) back to ttlTimestamp`);

  await collection.createIndex(
    { ttlTimestamp: 1 },
    { name: TTL_INDEX_NAME, expireAfterSeconds: expirationSeconds },
  );

  // Two things are deliberately NOT restored:
  // - the empty pages removed by up(): structural placeholders with no content,
  //   and the information needed to recreate exactly those is gone;
  // - the legacy field on pages exempted for having descendants: they end up with
  //   neither field, so the recreated TTL index cannot delete them. That is the
  //   safe direction — it is what `disableTtl` intended for them all along.
  logger.info('Rollback has successfully applied');
}
