import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:rename-ttl-timestamp-to-wip-expired-at');

const PAGES = 'pages';
const CONFIGS = 'configs';

const TTL_INDEX_NAME = 'ttlTimestamp_1';
const WIP_EXPIRED_AT_INDEX_NAME = 'wipExpiredAt_1';

/** Mirrors defaultValue of `app:wipPageExpirationSeconds` (48h). */
const DEFAULT_WIP_PAGE_EXPIRATION_SECONDS = 172800;

/**
 * Bounds both the size of each query and how many documents are resident. This runs
 * at boot against a collection of unknown size: an unbounded `$in` breaches the 16 MB
 * BSON limit, and materializing every legacy page costs hundreds of MB.
 */
const BATCH_SIZE = 1000;

/**
 * This migration uses the raw `db` handle only — no mongoose models, no service
 * imports. A migration must keep working against the schema as it stood at this
 * point in history; importing application code that continues to evolve makes it
 * rot silently.
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
 *   adding the duration is not enough on its own — a `ttlTimestamp` older than one
 *   window still converts to a past instant, which is the normal state on an
 *   instance whose TTL monitor was not reaping (TTL disabled on a managed MongoDB,
 *   a failed index creation, a long outage). Converting those faithfully hands the
 *   first sweep after the upgrade a mass deletion, and the new sweep deletes
 *   *completely* — revisions, attachments and search-index entries too, with no
 *   trash to restore from. So anything already overdue expires one window from the
 *   migration; anything still inside its window keeps its real deadline.
 *
 * WHY pages with descendants are exempted:
 *   `makeWip()` withholds the expiry from a page that already has children
 *   (`disableTtl`) because deleting it would orphan them — but that check only ran
 *   at creation, so legacy pages that acquired children later still carry the field.
 *   Granting them an expiry would park them permanently in the cron's "skipped,
 *   non-leaf" state. They get the legacy field dropped and no expiry, which is the
 *   state `makeWip()` would have produced had the children existed at creation.
 *
 * NOTE: this repairs the expiry field only. Inflated `descendantCount` values and
 * orphaned empty pages are the admin page tree repair's job (see the warning at the
 * end of `up`) — a boot-time migration must not stall an upgrade on a full scan.
 *
 * Consequence: "has descendants" is judged against the uncleaned tree, so a page
 * whose only children are orphaned placeholders is exempted rather than given an
 * expiry. Nothing is deleted, but it stays WIP with no expiry even after the repair
 * removes those placeholders, and must be published or deleted by hand.
 */
export async function up(db) {
  logger.info('Apply migration: ttlTimestamp -> wipExpiredAt');

  // Drop the TTL index FIRST so the TTL monitor cannot delete pages midway through.
  await dropIndexIfExists(db, PAGES, TTL_INDEX_NAME);

  const expirationSeconds = await resolveWipPageExpirationSeconds(db);
  const expirationMs = expirationSeconds * 1000;
  logger.info(
    `Converting with wipPageExpirationSeconds=${expirationSeconds} (${expirationMs} ms)`,
  );

  const collection = db.collection(PAGES);

  // Decided once, before the first batch: the warning below quotes `regrantedExpiry`,
  // so a per-batch value would make it wrong for every batch but the last.
  const migratedAt = new Date();
  // `ttlTimestamp + expirationMs < migratedAt`, restated as a bound on the stored
  // value so the pipeline and the JS count compare identically.
  const overdueBefore = new Date(migratedAt.getTime() - expirationMs);
  const regrantedExpiry = new Date(migratedAt.getTime() + expirationMs);

  let convertedCount = 0;
  let regranted = 0;
  let buffer = [];

  // Releasing the buffer is what keeps memory flat — batching the queries alone does
  // not, which is what the earlier `find().toArray()` got wrong.
  const flush = async () => {
    if (buffer.length === 0) {
      return;
    }
    const batch = buffer;
    buffer = [];

    // Resolve "has descendants" from the parent links, NOT from descendantCount:
    // inflating descendantCount is precisely the corruption this PR exists to fix,
    // so the stored counter cannot be trusted here. Per batch is equivalent to one
    // global pass — whether a page has a child depends on that page alone.
    const ids = batch.map((doc) => doc._id);
    const idsWithChildren = new Set(
      (await collection.distinct('parent', { parent: { $in: ids } })).map(String),
    );
    const expirable = batch.filter(
      (doc) => !idsWithChildren.has(String(doc._id)),
    );
    if (expirable.length === 0) {
      return;
    }

    const res = await collection.updateMany(
      { _id: { $in: expirable.map((doc) => doc._id) } },
      [
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
      ],
    );
    convertedCount += res.modifiedCount ?? 0;
    regranted += expirable.filter(
      (doc) => doc.ttlTimestamp < overdueBefore,
    ).length;
  };

  // Streamed rather than materialized — the TTL index is already dropped, so this is a
  // full scan, and reading it all in cost hundreds of MB at boot on a large wiki.
  //
  // Writing while the cursor is open is safe: only already-returned documents are
  // written, and WiredTiger updates in place, so no unread document is pushed past the
  // scan position. Re-querying with a limit instead would never terminate — pages with
  // descendants keep `ttlTimestamp` until the exemption below.
  const cursor = collection
    .find(
      { ttlTimestamp: { $ne: null } },
      { projection: { _id: 1, ttlTimestamp: 1 } },
    )
    .batchSize(BATCH_SIZE);

  for await (const doc of cursor) {
    buffer.push(doc);
    if (buffer.length >= BATCH_SIZE) {
      await flush();
    }
  }
  // The trailing partial batch: without this the exemption below strips its legacy
  // field as if those pages had children, leaving them with no expiry.
  await flush();

  logger.info(`Converted ${convertedCount} page(s) to wipExpiredAt`);

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

  const wasAffectedByTtlDeletion = convertedCount > 0 || exempted.modifiedCount > 0;
  if (wasAffectedByTtlDeletion) {
    logger.warn(
      'This instance previously used TTL-based WIP page expiry, which deleted pages ' +
        'without running application code, so some descendantCount values may be too ' +
        'high and there is a possibility that old empty pages exist that cannot be cleaned ' +
        'up automatically. To correct this, enable maintenance mode and run the page tree repair ' +
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
  // - the legacy field on pages exempted for having descendants: they end up with
  //   neither field, so the recreated TTL index cannot delete them. That is the
  //   safe direction — it is what `disableTtl` intended for them all along;
  // - the original instant on pages up() re-granted for being overdue: the re-grant
  //   discarded it, so subtracting the duration yields the migration time. A round
  //   trip hands them back with the extra window intact rather than letting the
  //   recreated index reap them at once — again the safe direction.
  logger.info('Rollback has successfully applied');
}
