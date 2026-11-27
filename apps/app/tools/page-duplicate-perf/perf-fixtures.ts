/**
 * Synthetic data and measurement helpers shared by the page-duplicate
 * performance measurements. Uses only models, the raw collections and
 * `crowi.pageService.duplicate`, so the same file also runs on the commit
 * before the page-duplicate spec (to measure "before").
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { type IUserHasId, PageGrant } from '@growi/core';
import { escapeStringForMongoRegex } from '@growi/core/dist/utils';
import type { HydratedDocument } from 'mongoose';
import mongoose, { Types } from 'mongoose';

import { PageActionType } from '~/interfaces/page-operation';
import type { PageDocument, PageModel } from '~/server/models/page';
import PageOperation from '~/server/models/page-operation';

export const BASE_PATH = '/perf-dup';
export const SOURCE_PATH = `${BASE_PATH}/src`;
const TOP_BODY_BYTES = 1024;

export interface TreeShape {
  /** Number of descendants under the source page (children + grandchildren). */
  readonly descendantCount: number;
  /** Number of direct children; the rest are spread over them as grandchildren. */
  readonly childCount: number;
  /** Total revisions over all descendants (each descendant gets at least one). */
  readonly revisionCount: number;
  /** Byte length (ASCII) of every descendant revision body. */
  readonly bodyBytes: number;
}

export interface SeededTree {
  readonly user: HydratedDocument<IUserHasId>;
  readonly source: HydratedDocument<PageDocument>;
  readonly descendantPaths: readonly string[];
}

const getPageModel = () => mongoose.model<PageDocument, PageModel>('Page');
const revisionsCollection = () => mongoose.connection.collection('revisions');

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function createPerfUser(
  name: string,
): Promise<HydratedDocument<IUserHasId>> {
  return mongoose.model<IUserHasId>('User').create({
    name,
    username: name,
    email: `${name}@example.com`,
    status: 2,
  });
}

/** Paths of the descendants, relative to the source: children first, then grandchildren. */
export function descendantSuffixes(shape: TreeShape): string[] {
  const children = Array.from({ length: shape.childCount }, (_, i) => `/c${i}`);
  const grandchildCount = shape.descendantCount - shape.childCount;
  const grandchildren = Array.from(
    { length: grandchildCount },
    (_, i) => `/c${i % shape.childCount}/g${i}`,
  );
  return [...children, ...grandchildren];
}

/**
 * Inserts one revision with a small body, doubles the body inside MongoDB up
 * to bodyBytes, then replicates the revision inside MongoDB. Large bodies never
 * pass through this process, so seeding does not leave freed-but-retained
 * memory that could hide growth during the measurement.
 */
async function insertRevisions(
  bodyBytes: number,
  authorId: Types.ObjectId,
  targets: readonly { _id: Types.ObjectId; pageId: Types.ObjectId }[],
): Promise<void> {
  const [first, ...rest] = targets;
  let seedBytes = bodyBytes;
  let doublings = 0;
  while (seedBytes > 1_000_000 && seedBytes % 2 === 0) {
    seedBytes /= 2;
    doublings += 1;
  }
  await revisionsCollection().insertOne({
    _id: first._id,
    pageId: first.pageId,
    body: 'x'.repeat(seedBytes),
    format: 'markdown',
    author: authorId,
    createdAt: new Date(),
    __v: 0,
  });
  for (let i = 0; i < doublings; i++) {
    // biome-ignore lint/performance/noAwaitInLoops: each doubling builds on the previous one
    await revisionsCollection().updateOne({ _id: first._id }, [
      { $set: { body: { $concat: ['$body', '$body'] } } },
    ]);
  }
  // Replicate in slices so the intermediate document stays small.
  for (let i = 0; i < rest.length; i += 200) {
    const slice = rest.slice(i, i + 200);
    // biome-ignore lint/performance/noAwaitInLoops: sequential on purpose
    await revisionsCollection()
      .aggregate([
        { $match: { _id: first._id } },
        { $set: { copies: slice } },
        { $unwind: '$copies' },
        { $set: { _id: '$copies._id', pageId: '$copies.pageId' } },
        { $unset: 'copies' },
        {
          $merge: {
            into: 'revisions',
            on: '_id',
            whenMatched: 'fail',
            whenNotMatched: 'insert',
          },
        },
      ])
      .toArray();
  }
}

/** Seeds /perf-dup/src (v5, on the page tree) with the given descendants. */
export async function seedTree(
  shape: TreeShape,
  userName: string,
): Promise<SeededTree> {
  const Page = getPageModel();
  const user = await createPerfUser(userName);
  const root =
    (await Page.findOne({ path: '/' })) ??
    (await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC }));

  const suffixes = descendantSuffixes(shape);
  const base = await Page.create({
    path: BASE_PATH,
    grant: PageGrant.GRANT_PUBLIC,
    parent: root._id,
    descendantCount: suffixes.length + 1,
  });

  // Top page: always a small body (the top body is read into the app anyway).
  const sourceId = new Types.ObjectId();
  const sourceRevisionId = new Types.ObjectId();
  await revisionsCollection().insertOne({
    _id: sourceRevisionId,
    pageId: sourceId,
    body: 't'.repeat(TOP_BODY_BYTES),
    format: 'markdown',
    author: user._id,
    createdAt: new Date(),
    __v: 0,
  });

  const pageIds = new Map<string, Types.ObjectId>(
    suffixes.map((s) => [s, new Types.ObjectId()]),
  );

  // Spread the revisions: every page gets floor(n/p), the first (n % p) one more.
  const perPage = Math.floor(shape.revisionCount / suffixes.length);
  const extra = shape.revisionCount % suffixes.length;
  const revisionTargets: { _id: Types.ObjectId; pageId: Types.ObjectId }[] = [];
  const currentRevision = new Map<string, Types.ObjectId>();
  suffixes.forEach((suffix, index) => {
    const pageId = pageIds.get(suffix) as Types.ObjectId;
    const count = perPage + (index < extra ? 1 : 0);
    for (let r = 0; r < count; r++) {
      const revisionId = new Types.ObjectId();
      revisionTargets.push({ _id: revisionId, pageId });
      currentRevision.set(suffix, revisionId); // the last one is the current
    }
  });
  await insertRevisions(shape.bodyBytes, user._id, revisionTargets);

  await Page.create({
    _id: sourceId,
    path: SOURCE_PATH,
    parent: base._id,
    grant: PageGrant.GRANT_PUBLIC,
    grantedUsers: [],
    grantedGroups: [],
    descendantCount: suffixes.length,
    revision: sourceRevisionId,
    creator: user._id,
    lastUpdateUser: user._id,
  });

  const grandchildCountOf = (childSuffix: string): number =>
    suffixes.filter((s) => s.startsWith(`${childSuffix}/`)).length;
  await Page.insertMany(
    suffixes.map((suffix) => {
      const isChild = suffix.split('/').length === 2;
      const parentSuffix = suffix.slice(0, suffix.lastIndexOf('/'));
      return {
        _id: pageIds.get(suffix),
        path: `${SOURCE_PATH}${suffix}`,
        parent: isChild ? sourceId : pageIds.get(parentSuffix),
        grant: PageGrant.GRANT_PUBLIC,
        grantedUsers: [],
        grantedGroups: [],
        descendantCount: isChild ? grandchildCountOf(suffix) : 0,
        revision: currentRevision.get(suffix),
        creator: user._id,
        lastUpdateUser: user._id,
      };
    }),
  );

  const source = await Page.findById(sourceId).orFail();
  return {
    user,
    source,
    descendantPaths: suffixes.map((s) => `${SOURCE_PATH}${s}`),
  };
}

export const findDuplicateOperation = (fromPath: string) =>
  PageOperation.findOne({ actionType: PageActionType.Duplicate, fromPath });

export async function waitUntilOperationGone(
  fromPath: string,
  timeoutMs = 30 * 60 * 1000,
): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    // biome-ignore lint/performance/noAwaitInLoops: polling
    if ((await findDuplicateOperation(fromPath)) == null) {
      return;
    }
    await sleep(50);
  }
  throw new Error(`PageOperation of ${fromPath} did not finish in time`);
}

/** Inspects the copy without reading bodies into this process. */
export async function inspectCopy(newPagePath: string) {
  const Page = getPageModel();
  const copies = await Page.find(
    { path: new RegExp(`^${escapeStringForMongoRegex(newPagePath)}/`) },
    { _id: 1, revision: 1, parent: 1, isEmpty: 1 },
  ).lean();
  const top = await Page.findOne({ path: newPagePath }).lean();
  const copyIds = copies.map((p) => p._id);
  const revisionStats = await revisionsCollection()
    .aggregate<{ _id: null; count: number; minLen: number; maxLen: number }>([
      { $match: { pageId: { $in: copyIds } } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          minLen: { $min: { $strLenBytes: '$body' } },
          maxLen: { $max: { $strLenBytes: '$body' } },
        },
      },
    ])
    .toArray();
  return {
    copiedNonEmptyPages: copies.filter((p) => !p.isEmpty).length,
    copiesWithoutParent: copies.filter((p) => p.parent == null).length,
    topDescendantCount: top?.descendantCount ?? null,
    copiedRevisionCount: revisionStats[0]?.count ?? 0,
    copiedBodyMinBytes: revisionStats[0]?.minLen ?? null,
    copiedBodyMaxBytes: revisionStats[0]?.maxLen ?? null,
  };
}

/** Deletes a copy (pages and their revisions) to keep the DB small between runs. */
export async function deleteCopy(newPagePath: string): Promise<void> {
  const Page = getPageModel();
  const filter = {
    path: new RegExp(`^${escapeStringForMongoRegex(newPagePath)}(/|$)`),
  };
  const ids = (await Page.find(filter, { _id: 1 }).lean()).map((p) => p._id);
  await revisionsCollection().deleteMany({ pageId: { $in: ids } });
  await Page.deleteMany({ _id: { $in: ids } });
}

const KB = 1024;

/** VmRSS / VmHWM of a process in bytes, from /proc. */
export function readProcMemory(pid: number | 'self' = 'self'): {
  rss: number;
  hwm: number;
} {
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  const pick = (key: string): number => {
    const m = status.match(new RegExp(`${key}:\\s+(\\d+) kB`));
    return m == null ? Number.NaN : Number(m[1]) * KB;
  };
  return { rss: pick('VmRSS'), hwm: pick('VmHWM') };
}

/** Resets VmHWM of a process to its current RSS (Linux >= 4.0). */
export function resetPeak(pid: number | 'self' = 'self'): void {
  writeFileSync(`/proc/${pid}/clear_refs`, '5');
}

/** PIDs of mongod processes started by this process (MongoMemoryServer). */
export function findChildMongodPids(): number[] {
  return readdirSync('/proc')
    .filter((d) => /^\d+$/.test(d))
    .filter((d) => {
      try {
        const stat = readFileSync(`/proc/${d}/stat`, 'utf8');
        const comm = stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')'));
        const ppid = Number(
          stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1],
        );
        return comm.startsWith('mongod') && ppid === process.pid;
      } catch {
        return false;
      }
    })
    .map(Number);
}

export function forceGc(): void {
  if (global.gc == null) {
    throw new Error('Run with --expose-gc (see vitest.config.mts)');
  }
  global.gc();
  global.gc();
}

export interface MemorySample {
  readonly rss: number;
  readonly heapUsed: number;
  readonly external: number;
  readonly arrayBuffers: number;
}

/**
 * Samples process.memoryUsage() every intervalMs and keeps the peak of each
 * field. Synchronous work can hide a peak from the sampler; VmHWM is the
 * authoritative peak of RSS.
 */
export function startSampler(intervalMs = 20) {
  const peak = { rss: 0, heapUsed: 0, external: 0, arrayBuffers: 0 };
  const take = () => {
    const m = process.memoryUsage();
    peak.rss = Math.max(peak.rss, m.rss);
    peak.heapUsed = Math.max(peak.heapUsed, m.heapUsed);
    peak.external = Math.max(peak.external, m.external);
    peak.arrayBuffers = Math.max(peak.arrayBuffers, m.arrayBuffers);
  };
  take();
  const timer = setInterval(take, intervalMs);
  return {
    stop: (): MemorySample => {
      clearInterval(timer);
      take();
      return { ...peak };
    },
  };
}

export const toMiB = (bytes: number): number =>
  Math.round((bytes / (1024 * 1024)) * 10) / 10;
