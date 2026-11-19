import type {
  OperationRecord,
  ReviewerRef,
  ReviewRecord,
  UserSummary,
  ViewerRole,
} from '../../interfaces';
import {
  latestReviews,
  reviewTargetValuesOf,
  toOperationDecisionViews,
  toParticipantHeaderFields,
} from './review-views';

const userOf = (id: string): UserSummary => ({
  id,
  username: `user-${id}`,
  name: `Name ${id}`,
});
const groupNameOf = (kind: string, id: string): string => `${kind}:${id}`;

const at = (minute: number): Date => new Date(Date.UTC(2026, 0, 1, 0, minute));

const review = (
  overrides: Partial<ReviewRecord> & Pick<ReviewRecord, 'by' | 'at'>,
): ReviewRecord => ({ kind: 'reject', channel: 'ui', ...overrides });

const edit = (
  key: string,
  index: number,
  overrides: Partial<Omit<OperationRecord, 'type'>> = {},
): OperationRecord => ({
  index,
  key,
  status: 'pending',
  type: 'edit',
  pageId: `page-${key}`,
  baseRevisionId: `rev-${key}`,
  body: `body-${key}`,
  ...overrides,
});

describe('latestReviews', () => {
  it('keeps only the newest record per person and key, whatever its kind (Req 17.4)', () => {
    const latest = latestReviews([
      review({ by: 'u1', at: at(1), operationKey: 'k1', comment: 'first' }),
      review({
        by: 'u1',
        at: at(2),
        operationKey: 'k1',
        kind: 'abstain',
        comment: 'second',
      }),
      review({ by: 'u2', at: at(1), operationKey: 'k1', comment: 'other' }),
      review({ by: 'u1', at: at(3), comment: 'whole' }),
    ]);

    expect(latest.map((r) => r.comment)).toEqual(['other', 'second', 'whole']);
  });

  it('takes the later entry when two records share the same time', () => {
    const latest = latestReviews([
      review({ by: 'u1', at: at(1), operationKey: 'k1', comment: 'a' }),
      review({ by: 'u1', at: at(1), operationKey: 'k1', comment: 'b' }),
    ]);

    expect(latest.map((r) => r.comment)).toEqual(['b']);
  });
});

describe('toOperationDecisionViews', () => {
  const requesterId = 'req';

  it('splits the latest records on the operation into rejections and abstentions (Req 17.8, 19.7)', () => {
    const views = toOperationDecisionViews({
      op: edit('k1', 0),
      latest: latestReviews([
        review({ by: 'u1', at: at(1), operationKey: 'k1', comment: 'no' }),
        review({ by: 'u2', at: at(2), operationKey: 'k1', kind: 'abstain' }),
        review({ by: 'u3', at: at(3), operationKey: 'k2', comment: 'other' }),
        review({ by: 'u4', at: at(4), comment: 'whole' }),
      ]),
      requesterId,
      userOf,
    });

    expect(views).toEqual({
      rejections: [
        { by: userOf('u1'), at: at(1).toISOString(), comment: 'no' },
      ],
      abstentions: [{ by: userOf('u2'), at: at(2).toISOString() }],
    });
  });

  it('returns a comment exactly as stored, without interpreting it (Req 17.7)', () => {
    const comment = '<script>alert(1)</script> **bold**';
    const views = toOperationDecisionViews({
      op: edit('k1', 0),
      latest: [review({ by: 'u1', at: at(1), operationKey: 'k1', comment })],
      requesterId,
      userOf,
    });

    expect(views.rejections?.[0]?.comment).toBe(comment);
  });

  it.each([
    ['a reviewer', 'u1', false],
    ['the requester', requesterId, true],
  ])('tells whether the approval came from the requester when %s approved (Req 16.8)', (_label, approvedBy, byRequester) => {
    const views = toOperationDecisionViews({
      op: edit('k1', 0, {
        approvedAt: at(5),
        approvedBy,
        approvedChannel: 'api',
      }),
      latest: [],
      requesterId,
      userOf,
    });

    expect(views).toEqual({
      approval: {
        by: userOf(approvedBy),
        at: at(5).toISOString(),
        channel: 'api',
        byRequester,
      },
    });
  });

  it('gives no approval to an operation approved without a person (auto-apply, revert)', () => {
    const views = toOperationDecisionViews({
      op: edit('k1', 0, { approvedAt: at(5) }),
      latest: [],
      requesterId,
      userOf,
    });

    expect(views).toEqual({});
  });
});

describe('toParticipantHeaderFields', () => {
  const reviewers: readonly ReviewerRef[] = [
    { kind: 'user', id: 'u1', addedBy: 'req', addedAt: at(1) },
    {
      kind: 'user-group',
      id: 'g1',
      addedBy: 'u1',
      addedAt: at(2),
      removedBy: 'u1',
      removedAt: at(3),
    },
  ];
  const latest = latestReviews([
    review({ by: 'u1', at: at(4), comment: 'whole' }),
    review({ by: 'u1', at: at(5), operationKey: 'k1' }),
  ]);
  const fieldsFor = (role: ViewerRole) =>
    toParticipantHeaderFields({
      role,
      purpose: '<b>why</b>',
      reviewers,
      latest,
      userOf,
      groupNameOf,
    });

  const reviewerViews = [
    {
      kind: 'user',
      id: 'u1',
      name: 'user-u1',
      addedBy: userOf('req'),
      addedAt: at(1).toISOString(),
    },
    {
      kind: 'user-group',
      id: 'g1',
      name: 'user-group:g1',
      addedBy: userOf('u1'),
      addedAt: at(2).toISOString(),
      removedBy: userOf('u1'),
      removedAt: at(3).toISOString(),
    },
  ];

  it('gives the requester the purpose, the reviewers and the whole-proposal rejections (Req 17.8, 19.1, 19.7)', () => {
    expect(fieldsFor('requester')).toEqual({
      purpose: '<b>why</b>',
      reviewers: reviewerViews,
      wholeRejections: [
        { by: userOf('u1'), at: at(4).toISOString(), comment: 'whole' },
      ],
    });
  });

  it('gives a reviewer the purpose as stored and the reviewers, never the whole-proposal rejections (Req 15.10, 17.8, 19.7)', () => {
    expect(fieldsFor('reviewer')).toEqual({
      purpose: '<b>why</b>',
      reviewers: reviewerViews,
    });
  });

  it('gives anyone else none of them', () => {
    expect(fieldsFor('other')).toEqual({});
  });
});

describe('reviewTargetValuesOf', () => {
  it('ranks the decision targets among the visible operations and tells whether an edit base is still the latest revision (Req 19.2)', () => {
    const applied = edit('k-applied', 2, { status: 'applied' });
    const stale = edit('k-stale-base', 7);
    const latestBase = edit('k-latest-base', 4);
    const create: OperationRecord = {
      index: 9,
      key: 'k-create',
      status: 'pending',
      type: 'create',
      path: '/new',
      body: 'b',
    };

    const values = reviewTargetValuesOf(
      [stale, create, applied, latestBase],
      new Set(['k-stale-base', 'k-latest-base', 'k-create']),
      (pageId) => (pageId === 'page-k-latest-base' ? 'rev-k-latest-base' : 'x'),
    );

    expect(Object.fromEntries(values)).toEqual({
      'k-latest-base': { order: 1, baseIsLatest: true },
      'k-stale-base': { order: 2, baseIsLatest: false },
      'k-create': { order: 3 },
    });
    // The applied operation holds rank 0: ranks count every visible operation.
    expect(values.has('k-applied')).toBe(false);
  });

  it('starts the rank at 0, like the requester index', () => {
    const values = reviewTargetValuesOf(
      [edit('k-only', 3)],
      new Set(['k-only']),
      () => null,
    );

    expect(Object.fromEntries(values)).toEqual({
      'k-only': { order: 0, baseIsLatest: false },
    });
  });
});
