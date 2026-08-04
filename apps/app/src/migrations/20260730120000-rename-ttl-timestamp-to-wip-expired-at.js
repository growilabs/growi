import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:rename-ttl-timestamp-to-wip-expired-at');

const PAGES = 'pages';
const CONFIGS = 'configs';

const TTL_INDEX_NAME = 'ttlTimestamp_1';
const WIP_EXPIRED_AT_INDEX_NAME = 'wipExpiredAt_1';

/** Mirrors defaultValue of `app:wipPageExpirationSeconds` (48h). */
const DEFAULT_WIP_PAGE_EXPIRATION_SECONDS = 172800;

/**
 * Backstops a data anomaly (e.g. a parent cycle) from spinning forever. Passes
 * after the first only re-examine the parents of what was just deleted, so this
 * caps the depth of the cascade, not how many pages can be removed.
 */
const MAX_EMPTY_CLEANUP_PASSES = 100;

/**
 * Bounds every id array this migration puts in a query, and every result set it
 * holds in memory. This runs at boot against a collection of unknown size: an
 * unbounded `$in` breaches the 16 MB BSON document limit and fails the upgrade.
 */
const BATCH_SIZE = 1000;

/** Runs `fn` over `items` in BATCH_SIZE slices and concatenates the results. */
async function inBatches(items, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    results.push(...(await fn(items.slice(i, i + BATCH_SIZE))));
  }
  return results;
}

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
 * Deletes a batch of childless empty pages and returns their parents, so the
 * caller can climb one level.
 *
 * The runtime service equivalent re-verifies childlessness and `isEmpty` here
 * because it runs against a live site. This copy deliberately does not: a
 * migration runs at boot before the server accepts requests, so nothing can
 * create a page under a candidate between the scan and the delete.
 */
async function deleteEmptyLeafBatch(collection, candidates) {
  const ids = candidates.map((p) => p._id);
  const res = await collection.deleteMany({ _id: { $in: ids } });
  return {
    removed: res.deletedCount ?? 0,
    parentIds: candidates.map((p) => p.parent).filter((id) => id != null),
  };
}

/** Scans the whole collection for childless empty pages, one bounded batch at a time. */
async function sweepAllEmptyLeaves(collection) {
  let removed = 0;
  const parentIds = [];

  for (;;) {
    const batch = await collection
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
        { $project: { _id: 1, parent: 1 } },
        { $limit: BATCH_SIZE },
      ])
      .toArray();

    if (batch.length === 0) {
      return { removed, parentIds };
    }

    const res = await deleteEmptyLeafBatch(collection, batch);
    removed += res.removed;
    parentIds.push(...res.parentIds);

    // Every candidate is deleted unconditionally here, so the next scan cannot
    // return the same batch. No $skip is needed (unlike the service copy, whose
    // live-site re-verification can decline a candidate).
  }
}

/** Re-examines the parents of what the previous pass removed. */
async function sweepCandidates(collection, candidateIds) {
  let removed = 0;
  const parentIds = [];

  for (let i = 0; i < candidateIds.length; i += BATCH_SIZE) {
    const ids = candidateIds.slice(i, i + BATCH_SIZE);
    const candidates = await collection
      .find(
        { _id: { $in: ids }, isEmpty: true, path: { $ne: '/' } },
        { projection: { _id: 1, parent: 1 } },
      )
      .toArray();

    if (candidates.length === 0) {
      continue;
    }
    const stillChildless = await filterChildless(collection, candidates);
    if (stillChildless.length === 0) {
      continue;
    }
    const res = await deleteEmptyLeafBatch(collection, stillChildless);
    removed += res.removed;
    parentIds.push(...res.parentIds);
  }

  return { removed, parentIds };
}

/** Of the given pages, the ones that have no children. */
async function filterChildless(collection, candidates) {
  const ids = candidates.map((p) => p._id);
  const withChildren = new Set(
    (await collection.distinct('parent', { parent: { $in: ids } })).map(String),
  );
  return candidates.filter((p) => !withChildren.has(String(p._id)));
}

/**
 * An empty page is a structural placeholder that only connects a real descendant
 * to its ancestors; once childless it serves no purpose. Historically the TTL
 * index deleted WIP pages without running application code, so the placeholders
 * that only hosted them were orphaned.
 *
 * Deleting one can leave its (also empty) parent childless, so the cascade
 * repeats — but only over the parents of what was just removed. Nothing else can
 * have become a childless empty page as a result of this run, so re-scanning the
 * whole collection per cascade level would re-read every page to find, at most, a
 * handful of newly exposed leaves. That matters here: this is a boot-time step.
 */
async function removeEmptyLeafHierarchies(db) {
  const collection = db.collection(PAGES);

  const first = await sweepAllEmptyLeaves(collection);

  let totalRemoved = first.removed;
  let candidateIds = first.parentIds;
  let pass = 1;

  for (; pass < MAX_EMPTY_CLEANUP_PASSES && candidateIds.length > 0; pass++) {
    const res = await sweepCandidates(collection, candidateIds);
    if (res.removed === 0) {
      return totalRemoved;
    }
    totalRemoved += res.removed;
    candidateIds = res.parentIds;
  }

  if (candidateIds.length > 0) {
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
 * as its expiry, so the stored value has the configured duration added to it.
 *
 * WHY an already-overdue page is re-granted a full window instead:
 *   adding the duration is not sufficient on its own — a `ttlTimestamp` older than
 *   one expiration window still converts to a past instant. That backlog is normal
 *   on an instance whose TTL monitor was not reaping (TTL disabled on a managed
 *   MongoDB, a failed index creation, a long monitor outage), and those are exactly
 *   the instances holding months-old values. Converting them faithfully would hand
 *   the first sweep after the upgrade a mass deletion — and the new sweep deletes
 *   *completely* (revisions, attachments and search-index entries go too, with no
 *   trash to restore from), so it is strictly more destructive than the TTL index it
 *   replaces. Anything already overdue therefore expires one full window from the
 *   migration, giving operators and authors a chance to notice before it goes.
 *   A page that is not yet overdue keeps its real deadline.
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

  const legacyDocs = await collection
    .find(
      { ttlTimestamp: { $ne: null } },
      { projection: { _id: 1, ttlTimestamp: 1 } },
    )
    .toArray();
  const legacyIds = legacyDocs.map((doc) => doc._id);

  // Resolve "has descendants" from the parent links, NOT from descendantCount:
  // inflating descendantCount is precisely the corruption this PR exists to fix,
  // so the stored counter cannot be trusted here.
  const idsWithChildren = await inBatches(legacyIds, (ids) =>
    collection.distinct('parent', { parent: { $in: ids } }),
  );
  const idsWithChildrenSet = new Set(idsWithChildren.map(String));
  const expirableDocs = legacyDocs.filter(
    (doc) => !idsWithChildrenSet.has(String(doc._id)),
  );
  const expirableIds = expirableDocs.map((doc) => doc._id);

  // One instant for both the boundary and the re-granted expiry, so the count
  // logged below describes exactly the documents the update re-grants.
  const migratedAt = new Date();
  // `ttlTimestamp + expirationMs < migratedAt` restated as a bound on the stored
  // value, so the comparison can be done in the pipeline and in JS identically.
  const overdueBefore = new Date(migratedAt.getTime() - expirationMs);
  const regrantedExpiry = new Date(migratedAt.getTime() + expirationMs);

  const convertedCounts = await inBatches(expirableIds, async (ids) => {
    const res = await collection.updateMany({ _id: { $in: ids } }, [
      {
        $set: {
          wipExpiredAt: {
            $cond: [
              { $lt: ['$ttlTimestamp', overdueBefore] },
              regrantedExpiry,
              { $add: ['$ttlTimestamp', expirationMs] },
            ],
          },
        },
      },
      { $unset: 'ttlTimestamp' },
    ]);
    return [res.modifiedCount ?? 0];
  });
  const convertedCount = convertedCounts.reduce((a, b) => a + b, 0);
  logger.info(`Converted ${convertedCount} page(s) to wipExpiredAt`);

  const regranted = expirableDocs.filter(
    (doc) => doc.ttlTimestamp < overdueBefore,
  ).length;
  if (regranted > 0) {
    logger.warn(
      `${regranted} page(s) were already past their expiry before this migration ` +
        '(the TTL monitor had not reaped them). Rather than letting the first ' +
        'cleanup run delete them all at once, they were re-granted a full ' +
        `expiration window and now expire at ${regrantedExpiry.toISOString()}. ` +
        'Publish or move anything that must be kept before then.',
    );
  }

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
    removed > 0 || convertedCount > 0 || exempted.modifiedCount > 0;
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

  // Three things are deliberately NOT restored:
  // - the empty pages removed by up(): structural placeholders with no content,
  //   and the information needed to recreate exactly those is gone;
  // - the legacy field on pages exempted for having descendants: they end up with
  //   neither field, so the recreated TTL index cannot delete them. That is the
  //   safe direction — it is what `disableTtl` intended for them all along;
  // - the original instant on pages up() re-granted for being already overdue:
  //   subtracting the duration yields the migration time, not their real
  //   ttlTimestamp, which the re-grant deliberately discarded. So a round trip
  //   hands them back to the TTL index with the extra window intact rather than
  //   letting the recreated index reap them immediately — again the safe direction.
  logger.info('Rollback has successfully applied');
}
