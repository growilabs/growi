import { ActivityLogActions } from '~/interfaces/activity';
import type { RawPageFilter } from '~/server/util/prisma-raw-normalize';

import {
  buildTargetPageIdsPipeline,
  buildVisibleActivitiesPipeline,
  buildVisiblePagesQuery,
} from './build-user-activity-queries';

const USER_ID = '65f000000000000000000001';
const PAGE_ID_A = '65f0000000000000000000a1';
const PAGE_ID_B = '65f0000000000000000000a2';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Collects every value stored under `key`, at any depth, regardless of stage layout.
const collectValuesByKey = (node: unknown, key: string): unknown[] => {
  if (Array.isArray(node)) {
    return node.flatMap((item) => collectValuesByKey(item, key));
  }
  if (!isRecord(node)) {
    return [];
  }
  return Object.entries(node).flatMap(([k, v]) => [
    ...(k === key ? [v] : []),
    ...collectValuesByKey(v, key),
  ]);
};

const collectActionSets = (pipeline: unknown): unknown[] =>
  collectValuesByKey(pipeline, 'action').flatMap((v) =>
    isRecord(v) && '$in' in v ? [v.$in] : [],
  );

describe('buildTargetPageIdsPipeline', () => {
  it('restricts to the supported actions defined by ActivityLogActions', () => {
    const pipeline = buildTargetPageIdsPipeline(USER_ID);

    expect(collectActionSets(pipeline)).toEqual([
      Object.values(ActivityLogActions),
    ]);
  });

  it('matches the target user in the raw ObjectId form', () => {
    const pipeline = buildTargetPageIdsPipeline(USER_ID);

    expect(collectValuesByKey(pipeline, 'user')).toContainEqual({
      $oid: USER_ID,
    });
  });
});

describe('buildVisiblePagesQuery', () => {
  const pageFilter: RawPageFilter = { grant: 1, wip: null };

  it('keeps the given page filter as it is and adds the id restriction in raw form', () => {
    const { filter } = buildVisiblePagesQuery(
      [PAGE_ID_A, PAGE_ID_B],
      pageFilter,
    );

    expect(JSON.stringify(filter)).toContain(JSON.stringify(pageFilter));
    expect(collectValuesByKey(filter, '_id')).toContainEqual({
      $in: [{ $oid: PAGE_ID_A }, { $oid: PAGE_ID_B }],
    });
  });

  it('projects only _id and path', () => {
    const { projection } = buildVisiblePagesQuery([PAGE_ID_A], pageFilter);

    expect(projection).toEqual({ _id: 1, path: 1 });
  });

  it('does not modify the given page filter', () => {
    const original: RawPageFilter = { grant: 1, wip: null };
    buildVisiblePagesQuery([PAGE_ID_A], original);

    expect(original).toEqual({ grant: 1, wip: null });
  });
});

describe('buildVisibleActivitiesPipeline', () => {
  const build = (limit = 20, offset = 40) =>
    buildVisibleActivitiesPipeline({
      targetUserId: USER_ID,
      visiblePageIds: [PAGE_ID_A, PAGE_ID_B],
      limit,
      offset,
    });

  it('restricts to the supported actions defined by ActivityLogActions, same as step 1', () => {
    expect(collectActionSets(build())).toEqual(
      collectActionSets(buildTargetPageIdsPipeline(USER_ID)),
    );
    expect(collectActionSets(build())).toEqual([
      Object.values(ActivityLogActions),
    ]);
  });

  it('restricts to the target user and the visible page ids in raw form', () => {
    const pipeline = build();

    expect(collectValuesByKey(pipeline, 'user')).toContainEqual({
      $oid: USER_ID,
    });
    expect(collectValuesByKey(pipeline, 'target')).toContainEqual({
      $in: [{ $oid: PAGE_ID_A }, { $oid: PAGE_ID_B }],
    });
  });

  it('sorts by createdAt descending, then _id descending', () => {
    const [sort] = collectValuesByKey(build(), '$sort');

    expect(sort).toEqual({ createdAt: -1, _id: -1 });
  });

  it('passes limit and offset through to the page slice', () => {
    const pipeline = build(25, 50);

    expect(collectValuesByKey(pipeline, '$limit')).toEqual([25]);
    expect(collectValuesByKey(pipeline, '$skip')).toEqual([50]);
  });

  it('projects only the activity id, action, createdAt and target page id', () => {
    const [projection] = collectValuesByKey(build(), '$project');

    expect(projection).toEqual({
      _id: 1,
      action: 1,
      createdAt: 1,
      target: 1,
    });
  });

  it('does not join other collections', () => {
    expect(collectValuesByKey(build(), '$lookup')).toEqual([]);
  });

  it('computes the total count over the same match as the page slice', () => {
    const [facet] = collectValuesByKey(build(), '$facet');

    expect(facet).toEqual({
      totalCount: [{ $count: 'count' }],
      docs: expect.any(Array),
    });
  });
});
