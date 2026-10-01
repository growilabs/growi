import type { CreateIndexesOptions, Db, IndexSpecification } from 'mongodb';

export const PAGE_LINKS_COLLECTION = 'pagelinks';

/**
 * The indexes `pagelinks` requires.
 *
 * `fromPage_1_toPath_1` is a correctness constraint, not a tuning choice:
 * `replaceOutboundLinks` upserts against that filter, so without the unique index
 * concurrent replaces of one source page can insert duplicate rows.
 *
 * **Production provisions these from
 * `migrations/20260901064500-add-indexes-to-pagelinks.js`, not from here** — a migration
 * is an immutable snapshot, so it deliberately repeats the list rather than importing
 * it. This declaration exists because the integration harness skips migrations on the
 * default in-memory MongoDB (`test/setup/migrate-mongo.ts` runs them only against an
 * external `MONGO_URI`), which would otherwise leave every integ test running against an
 * index-less collection and quietly vacate the idempotency guarantees they assert.
 *
 * The two lists are kept honest by the index inventory assertion in
 * `page-link-read-perf.integ.ts`, which runs against external MongoDB — where the
 * migration really has run — and fails on any mismatch.
 */
export const PAGE_LINK_INDEXES: readonly {
  key: IndexSpecification;
  options: CreateIndexesOptions;
}[] = [
  { key: { fromPage: 1, toPath: 1 }, options: { unique: true } },
  { key: { toPage: 1 }, options: {} },
  { key: { toPath: 1 }, options: {} },
];

/** Idempotent: `createIndex` is a no-op when the identical index already exists. */
export const ensurePageLinkIndexes = async (db: Db): Promise<void> => {
  const collection = db.collection(PAGE_LINKS_COLLECTION);
  await Promise.all(
    PAGE_LINK_INDEXES.map(({ key, options }) =>
      collection.createIndex(key, options),
    ),
  );
};
