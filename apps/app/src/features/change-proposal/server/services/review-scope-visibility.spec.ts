import type {
  OperationRecord,
  OperationStatus,
  ViewerRole,
} from '../../interfaces';
import {
  ancestorPathsToLoad,
  decideReviewScope,
  pageIdsToLoad,
  type ReviewScopeFacts,
} from './review-scope-visibility';

const edit = (
  key: string,
  status: OperationStatus,
  pageId: string,
): OperationRecord => ({
  index: 0,
  key,
  status,
  type: 'edit',
  pageId,
  baseRevisionId: 'r',
  body: 'b',
});

const create = (
  key: string,
  status: OperationStatus,
  path: string,
  resultPageId?: string,
): OperationRecord => ({
  index: 0,
  key,
  status,
  type: 'create',
  path,
  body: 'b',
  ...(resultPageId == null ? {} : { resultPageId }),
});

const move = (
  key: string,
  status: OperationStatus,
  pageId: string,
  toPath: string,
): OperationRecord => ({
  index: 0,
  key,
  status,
  type: 'move',
  pageId,
  fromPath: '/from/x',
  toPath,
});

const facts = (args: {
  viewable?: readonly string[];
  anyoneWithLink?: readonly string[];
  deleted?: readonly string[];
  // Several pages can share a path, so a path maps to every page found there.
  nonEmpty?: Readonly<Record<string, string | readonly string[]>>;
}): ReviewScopeFacts => ({
  viewable: {
    viewablePageIds: new Set([
      ...(args.viewable ?? []),
      ...(args.anyoneWithLink ?? []),
    ]),
    anyoneWithLinkPageIds: new Set(args.anyoneWithLink ?? []),
    deletedPageIds: new Set(args.deleted ?? []),
  },
  nonEmptyPageIdByPath: new Map(
    Object.entries(args.nonEmpty ?? {}).map(([path, ids]) => [
      path,
      typeof ids === 'string' ? [ids] : ids,
    ]),
  ),
});

const decide = (
  operations: readonly OperationRecord[],
  role: ViewerRole,
  f: ReviewScopeFacts,
) => {
  const result = decideReviewScope(operations, role, f);
  return {
    visible: [...result.visibleKeys].sort(),
    targets: [...result.reviewTargetKeys].sort(),
    stage: result.visibleStage,
  };
};

describe('decideReviewScope for a reviewer', () => {
  it('returns a pending edit whose page the reviewer can view as a decision target (Reviewers Req 2.2, 5.6)', () => {
    expect(
      decide(
        [edit('a', 'pending', 'p1')],
        'reviewer',
        facts({ viewable: ['p1'] }),
      ),
    ).toEqual({ visible: ['a'], targets: ['a'], stage: 'open' });
  });

  it('treats an operation on a page the reviewer cannot view as absent (Reviewers Req 2.6, 5.4)', () => {
    expect(decide([edit('a', 'pending', 'p1')], 'reviewer', facts({}))).toEqual(
      { visible: [], targets: [], stage: 'settled' },
    );
  });

  it('hides an operation on an "anyone with the link" page (Reviewers Req 5.6)', () => {
    expect(
      decide(
        [edit('a', 'pending', 'p1')],
        'reviewer',
        facts({ anyoneWithLink: ['p1'] }),
      ).visible,
    ).toEqual([]);
  });

  it('judges a create by its closest non-empty ancestor (Reviewers Req 2.2, 5.6)', () => {
    const ops = [create('a', 'pending', '/x/y/new')];
    const nonEmpty = { '/x': 'px', '/': 'root' };
    expect(
      decide(ops, 'reviewer', facts({ viewable: ['px'], nonEmpty })).visible,
    ).toEqual(['a']);
    // The root is viewable, yet the closest ancestor /x is not.
    expect(
      decide(ops, 'reviewer', facts({ viewable: ['root'], nonEmpty })).visible,
    ).toEqual([]);
  });

  it('hides a create whose closest ancestor is an "anyone with the link" page (Reviewers Req 5.6)', () => {
    expect(
      decide(
        [create('a', 'pending', '/x/new')],
        'reviewer',
        facts({ anyoneWithLink: ['px'], nonEmpty: { '/x': 'px' } }),
      ).visible,
    ).toEqual([]);
  });

  it('hides a create when no ancestor can be resolved, even the root (Reviewers Req 5.6)', () => {
    expect(
      decide(
        [create('a', 'pending', '/x/new')],
        'reviewer',
        facts({ viewable: ['px'] }),
      ),
    ).toEqual({ visible: [], targets: [], stage: 'settled' });
  });

  it('hides an operation that rests on no page at all, such as a create at the root (Reviewers Req 5.6)', () => {
    expect(
      decide(
        [create('a', 'pending', '/')],
        'reviewer',
        facts({ viewable: ['root'], nonEmpty: { '/': 'root' } }),
      ),
    ).toEqual({ visible: [], targets: [], stage: 'settled' });
  });

  it('hides a create or a move when any page sharing the closest ancestor path cannot be viewed (Reviewers Req 5.6)', () => {
    const ops = [
      create('create', 'pending', '/x/new'),
      move('move', 'pending', 'src', '/x/moved'),
    ];
    const nonEmpty = { '/x': ['px', 'px-same-path'] };
    expect(
      decide(ops, 'reviewer', facts({ viewable: ['src', 'px'], nonEmpty }))
        .visible,
    ).toEqual([]);
    expect(
      decide(
        ops,
        'reviewer',
        facts({
          viewable: ['src', 'px'],
          anyoneWithLink: ['px-same-path'],
          nonEmpty,
        }),
      ).visible,
    ).toEqual([]);
    expect(
      decide(
        ops,
        'reviewer',
        facts({ viewable: ['src', 'px', 'px-same-path'], nonEmpty }),
      ).visible,
    ).toEqual(['create', 'move']);
  });

  it('requires both the move source and the destination parent to be viewable (Reviewers Req 2.2, 5.6)', () => {
    const ops = [move('a', 'pending', 'src', '/dest/moved')];
    const nonEmpty = { '/dest': 'pd' };
    expect(
      decide(ops, 'reviewer', facts({ viewable: ['src', 'pd'], nonEmpty }))
        .visible,
    ).toEqual(['a']);
    expect(
      decide(ops, 'reviewer', facts({ viewable: ['src'], nonEmpty })).visible,
    ).toEqual([]);
    expect(
      decide(ops, 'reviewer', facts({ viewable: ['pd'], nonEmpty })).visible,
    ).toEqual([]);
    expect(
      decide(
        ops,
        'reviewer',
        facts({ viewable: ['src'], anyoneWithLink: ['pd'], nonEmpty }),
      ).visible,
    ).toEqual([]);
  });

  it('shows skipped, stale and failed operations by the review scope but only pending ones are targets (Reviewers Req 2.2)', () => {
    const ops = [
      edit('pending', 'pending', 'p1'),
      edit('skipped', 'skipped', 'p1'),
      edit('stale', 'stale', 'p1'),
      edit('failed', 'failed', 'p1'),
    ];
    expect(decide(ops, 'reviewer', facts({ viewable: ['p1'] }))).toEqual({
      visible: ['failed', 'pending', 'skipped', 'stale'],
      targets: ['pending'],
      stage: 'open',
    });
  });

  it('decides applied, reverted and revert-refused operations by the rule for other viewers (Reviewers Req 5.10)', () => {
    // The parent is viewable, the created page is not: the reviewer judged the
    // pending create by the parent, but the applied one by the created page.
    const nonEmpty = { '/x': 'px' };
    const ops = [
      create('applied-create', 'applied', '/x/new', 'created'),
      create('pending-create', 'pending', '/x/other'),
      edit('reverted', 'reverted', 'p1'),
      edit('refused', 'revert-refused', 'p-link'),
    ];
    expect(
      decide(
        ops,
        'reviewer',
        facts({ viewable: ['px', 'p1'], anyoneWithLink: ['p-link'], nonEmpty }),
      ).visible,
    ).toEqual(['pending-create', 'reverted']);
  });

  it('derives the stage only from visible operations (Reviewers Req 5.6)', () => {
    const ops = [edit('seen', 'failed', 'p1'), edit('hidden', 'pending', 'p2')];
    expect(decide(ops, 'reviewer', facts({ viewable: ['p1'] }))).toEqual({
      visible: ['seen'],
      targets: [],
      stage: 'settled',
    });
  });
});

describe('decideReviewScope for the requester and other viewers', () => {
  const ops = [
    edit('pending', 'pending', 'p1'),
    edit('link', 'pending', 'p-link'),
    edit('applied', 'applied', 'p1'),
    create('unapplied-create', 'failed', '/x/new'),
  ];
  const f = facts({ viewable: ['p1'], anyoneWithLink: ['p-link'] });

  it('keeps the current rule for the requester', () => {
    expect(decide(ops, 'requester', f)).toEqual({
      visible: ['applied', 'link', 'pending', 'unapplied-create'],
      targets: ['link', 'pending'],
      stage: 'open',
    });
  });

  it('keeps the current rule for a viewer who is neither requester nor reviewer (Reviewers Req 5.10)', () => {
    expect(decide(ops, 'other', f)).toEqual({
      visible: ['applied'],
      targets: [],
      stage: 'settled',
    });
  });
});

describe('what the resolver loads', () => {
  const ops = [
    create('c', 'pending', '/x/y/new'),
    move('m', 'pending', 'src', '/x/moved'),
    create('done', 'applied', '/z/new', 'created'),
    edit('e', 'pending', 'p1'),
  ];

  it('asks for ancestor candidates only of operations a reviewer judges by the review scope', () => {
    expect([...ancestorPathsToLoad(ops, 'reviewer')].sort()).toEqual([
      '/',
      '/x',
      '/x/y',
    ]);
    expect(ancestorPathsToLoad(ops, 'requester')).toEqual([]);
    expect(ancestorPathsToLoad(ops, 'other')).toEqual([]);
  });

  it('checks the resolved ancestors, the move source and the target pages', () => {
    const nonEmpty = new Map([
      ['/x', ['px', 'px-same-path']],
      ['/', ['root']],
    ]);
    expect([...pageIdsToLoad(ops, 'reviewer', nonEmpty)].sort()).toEqual([
      'created',
      'p1',
      'px',
      'px-same-path',
      'src',
    ]);
    expect([...pageIdsToLoad(ops, 'requester', nonEmpty)].sort()).toEqual([
      'created',
      'p1',
      'src',
    ]);
  });
});
