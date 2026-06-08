/**
 * reconcile-acl-evaluator.spec.ts
 *
 * Unit tests for AclEvaluator (Task 2.3).
 *
 * Requirements: 2.2, 2.3, 2.4, 2.5
 *
 * Key assertions:
 * - Admin path: baseQuery is returned unchanged, no DB I/O
 * - Non-admin path: getUserRelatedGroups called once, addConditionToFilteringByViewer
 *   called with correct args, eligibleQuery contains merged conditions
 * - countDocuments is NEVER called
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAclEvaluator } from '../reconcile-acl-evaluator';
import type { PageQueryFilter } from '../reconcile-target-resolver';

// ---------------------------------------------------------------------------
// Helpers / mock factories
// ---------------------------------------------------------------------------

/**
 * Creates a minimal IUserHasId-like object for testing.
 */
function makeUser(id: string) {
  return { _id: id, username: `user_${id}` } as any;
}

/**
 * Creates a mock PopulatedGrantedGroup with the { type, item } structure.
 * getUserRelatedGroups returns PopulatedGrantedGroup[], where _id lives on item.
 */
function makeGroup(id: string) {
  return { type: 'userGroup', item: { _id: id, name: `group_${id}` } } as any;
}

/**
 * Creates a mock PageQueryBuilder that records calls and has a predictable
 * getFilter() output. The builder merges conditions by tracking what was AND-ed.
 */
function makePageQueryBuilderMock(baseFilter: PageQueryFilter) {
  const appliedConditions: unknown[] = [];

  const queryMock = {
    and: vi.fn((condition: unknown) => {
      appliedConditions.push(condition);
      return queryMock; // chainable
    }),
    getFilter: vi.fn(() => ({
      ...baseFilter,
      _merged: appliedConditions,
    })),
    // Expose for assertions
    _appliedConditions: appliedConditions,
  };

  return queryMock;
}

/**
 * Creates a mock PageModel that:
 * - has a `find` method returning the given queryMock
 * - has a `PageQueryBuilder` constructor (accessible via pageModel.PageQueryBuilder)
 *   that wraps the given queryMock
 * - exposes a `countDocuments` spy to verify it is never called
 */
function makePageModelMock(
  queryMock: ReturnType<typeof makePageQueryBuilderMock>,
) {
  const addConditionToFilteringByViewer = vi.fn(function (
    this: { query: typeof queryMock },
    _user: unknown,
    _groupIds: unknown[],
    ..._args: unknown[]
  ) {
    // The builder mutates its internal query — simulate it
    return this;
  });

  // PageQueryBuilder constructor stores query and delegates to our mock
  class MockPageQueryBuilder {
    query: typeof queryMock;

    constructor(_query: unknown, _includeEmpty = false) {
      this.query = queryMock;
    }

    addConditionToFilteringByViewer = addConditionToFilteringByViewer;
  }

  const countDocumentsSpy = vi.fn();

  const pageModelMock = {
    find: vi.fn((_filter: PageQueryFilter) => queryMock),
    countDocuments: countDocumentsSpy,
    PageQueryBuilder: MockPageQueryBuilder,
    // expose spy for assertions
    _addConditionToFilteringByViewer: addConditionToFilteringByViewer,
    _countDocumentsSpy: countDocumentsSpy,
  };

  return pageModelMock;
}

// ---------------------------------------------------------------------------
// createAclEvaluator — admin path
// ---------------------------------------------------------------------------

describe('createAclEvaluator — admin path (isAdmin: true)', () => {
  const baseQuery: PageQueryFilter = { path: '/foo' };
  const user = makeUser('admin-1');

  let pageModelMock: ReturnType<typeof makePageModelMock>;
  let pageGrantServiceMock: { getUserRelatedGroups: ReturnType<typeof vi.fn> };
  let evaluator: ReturnType<typeof createAclEvaluator>;

  beforeEach(() => {
    const queryMock = makePageQueryBuilderMock(baseQuery);
    pageModelMock = makePageModelMock(queryMock);
    pageGrantServiceMock = {
      getUserRelatedGroups: vi.fn(),
    };
    evaluator = createAclEvaluator({
      pageModel: pageModelMock as any,
      pageGrantService: pageGrantServiceMock as any,
    });
  });

  it('returns eligibleQuery equal to baseQuery (no modification)', async () => {
    const result = await evaluator.buildEligibleQuery({
      user,
      isAdmin: true,
      baseQuery,
    });

    expect(result.eligibleQuery).toEqual(baseQuery);
  });

  it('does NOT call pageGrantService.getUserRelatedGroups', async () => {
    await evaluator.buildEligibleQuery({ user, isAdmin: true, baseQuery });
    expect(pageGrantServiceMock.getUserRelatedGroups).not.toHaveBeenCalled();
  });

  it('does NOT call pageModel.find', async () => {
    await evaluator.buildEligibleQuery({ user, isAdmin: true, baseQuery });
    expect(pageModelMock.find).not.toHaveBeenCalled();
  });

  it('does NOT call countDocuments', async () => {
    await evaluator.buildEligibleQuery({ user, isAdmin: true, baseQuery });
    expect(pageModelMock._countDocumentsSpy).not.toHaveBeenCalled();
  });

  it('result is exact reference or deep-equal to baseQuery', async () => {
    const result = await evaluator.buildEligibleQuery({
      user,
      isAdmin: true,
      baseQuery,
    });
    // Admin path must return baseQuery unchanged (by reference or deep-equal)
    expect(result.eligibleQuery).toStrictEqual(baseQuery);
  });
});

// ---------------------------------------------------------------------------
// createAclEvaluator — non-admin path
// ---------------------------------------------------------------------------

describe('createAclEvaluator — non-admin path (isAdmin: false)', () => {
  const baseQuery: PageQueryFilter = { path: { $regex: '^/foo/' } };
  const user = makeUser('user-1');
  const groups = [makeGroup('grp-a'), makeGroup('grp-b')];

  let queryMock: ReturnType<typeof makePageQueryBuilderMock>;
  let pageModelMock: ReturnType<typeof makePageModelMock>;
  let pageGrantServiceMock: { getUserRelatedGroups: ReturnType<typeof vi.fn> };
  let evaluator: ReturnType<typeof createAclEvaluator>;

  beforeEach(() => {
    queryMock = makePageQueryBuilderMock(baseQuery);
    pageModelMock = makePageModelMock(queryMock);
    pageGrantServiceMock = {
      getUserRelatedGroups: vi.fn().mockResolvedValue(groups),
    };
    evaluator = createAclEvaluator({
      pageModel: pageModelMock as any,
      pageGrantService: pageGrantServiceMock as any,
    });
  });

  it('calls getUserRelatedGroups exactly once with the user', async () => {
    await evaluator.buildEligibleQuery({ user, isAdmin: false, baseQuery });
    expect(pageGrantServiceMock.getUserRelatedGroups).toHaveBeenCalledTimes(1);
    expect(pageGrantServiceMock.getUserRelatedGroups).toHaveBeenCalledWith(
      user,
    );
  });

  it('creates PageQueryBuilder with baseQuery via pageModel.find', async () => {
    await evaluator.buildEligibleQuery({ user, isAdmin: false, baseQuery });
    expect(pageModelMock.find).toHaveBeenCalledTimes(1);
    expect(pageModelMock.find).toHaveBeenCalledWith(baseQuery);
  });

  it('calls addConditionToFilteringByViewer with user and group _ids', async () => {
    await evaluator.buildEligibleQuery({ user, isAdmin: false, baseQuery });

    const spy = pageModelMock._addConditionToFilteringByViewer;
    expect(spy).toHaveBeenCalledTimes(1);

    const [calledUser, calledGroupIds, ...restArgs] = spy.mock.calls[0];
    expect(calledUser).toBe(user);
    expect(calledGroupIds).toEqual(['grp-a', 'grp-b']); // map(g => g._id)
    // All three boolean flags must be false (includeAnyoneWithTheLink=false,
    // showPagesRestrictedByOwner=false, showPagesRestrictedByGroup=false)
    expect(restArgs).toEqual([false, false, false]);
  });

  it('returns eligibleQuery from builder.query.getFilter()', async () => {
    const result = await evaluator.buildEligibleQuery({
      user,
      isAdmin: false,
      baseQuery,
    });
    // The eligibleQuery must come from the builder's query.getFilter()
    expect(result.eligibleQuery).toEqual(queryMock.getFilter());
  });

  it('does NOT call countDocuments', async () => {
    await evaluator.buildEligibleQuery({ user, isAdmin: false, baseQuery });
    expect(pageModelMock._countDocumentsSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createAclEvaluator — non-admin with zero groups
// ---------------------------------------------------------------------------

describe('createAclEvaluator — non-admin with no user groups', () => {
  const baseQuery: PageQueryFilter = { path: '/bar' };
  const user = makeUser('user-solo');

  let queryMock: ReturnType<typeof makePageQueryBuilderMock>;
  let pageModelMock: ReturnType<typeof makePageModelMock>;
  let pageGrantServiceMock: { getUserRelatedGroups: ReturnType<typeof vi.fn> };
  let evaluator: ReturnType<typeof createAclEvaluator>;

  beforeEach(() => {
    queryMock = makePageQueryBuilderMock(baseQuery);
    pageModelMock = makePageModelMock(queryMock);
    pageGrantServiceMock = {
      getUserRelatedGroups: vi.fn().mockResolvedValue([]),
    };
    evaluator = createAclEvaluator({
      pageModel: pageModelMock as any,
      pageGrantService: pageGrantServiceMock as any,
    });
  });

  it('calls addConditionToFilteringByViewer with empty groupIds array', async () => {
    await evaluator.buildEligibleQuery({ user, isAdmin: false, baseQuery });

    const spy = pageModelMock._addConditionToFilteringByViewer;
    expect(spy).toHaveBeenCalledTimes(1);
    const [, calledGroupIds] = spy.mock.calls[0];
    expect(calledGroupIds).toEqual([]);
  });

  it('still returns eligibleQuery without throwing', async () => {
    const result = await evaluator.buildEligibleQuery({
      user,
      isAdmin: false,
      baseQuery,
    });
    expect(result).toHaveProperty('eligibleQuery');
  });
});

// ---------------------------------------------------------------------------
// createAclEvaluator — countDocuments spy (system-level guard)
// ---------------------------------------------------------------------------

describe('createAclEvaluator — countDocuments never called (system guard)', () => {
  it('does not call countDocuments in admin path', async () => {
    const baseQuery: PageQueryFilter = { path: '/admin' };
    const queryMock = makePageQueryBuilderMock(baseQuery);
    const pageModelMock = makePageModelMock(queryMock);
    const pageGrantServiceMock = { getUserRelatedGroups: vi.fn() };

    const evaluator = createAclEvaluator({
      pageModel: pageModelMock as any,
      pageGrantService: pageGrantServiceMock as any,
    });

    await evaluator.buildEligibleQuery({
      user: makeUser('a'),
      isAdmin: true,
      baseQuery,
    });

    expect(pageModelMock._countDocumentsSpy).toHaveBeenCalledTimes(0);
  });

  it('does not call countDocuments in non-admin path', async () => {
    const baseQuery: PageQueryFilter = { path: '/user' };
    const queryMock = makePageQueryBuilderMock(baseQuery);
    const pageModelMock = makePageModelMock(queryMock);
    const pageGrantServiceMock = {
      getUserRelatedGroups: vi.fn().mockResolvedValue([makeGroup('g1')]),
    };

    const evaluator = createAclEvaluator({
      pageModel: pageModelMock as any,
      pageGrantService: pageGrantServiceMock as any,
    });

    await evaluator.buildEligibleQuery({
      user: makeUser('u1'),
      isAdmin: false,
      baseQuery,
    });

    expect(pageModelMock._countDocumentsSpy).toHaveBeenCalledTimes(0);
  });
});
