import type { OperationRecord, OperationStatus } from '../../interfaces';
import {
  buildReviewRequestPages,
  buildReviewResultContent,
  selectReviewRequestRecipientIds,
} from './review-notification-content';

const edit = (
  key: string,
  pageId: string,
  status: OperationStatus = 'pending',
): OperationRecord => ({
  index: 0,
  key,
  status,
  type: 'edit',
  pageId,
  baseRevisionId: 'base',
  body: 'body',
});

const create = (key: string, path: string): OperationRecord => ({
  index: 0,
  key,
  status: 'pending',
  type: 'create',
  path,
  body: 'body',
});

const move = (key: string, pageId: string): OperationRecord => ({
  index: 0,
  key,
  status: 'pending',
  type: 'move',
  pageId,
  fromPath: '/from',
  toPath: '/to',
});

describe('selectReviewRequestRecipientIds', () => {
  it('picks individual users only, never a group (Req 20.2)', () => {
    expect(
      selectReviewRequestRecipientIds(
        [
          { kind: 'user', id: 'u1' },
          { kind: 'user-group', id: 'g1' },
          { kind: 'external-user-group', id: 'eg1' },
          { kind: 'user', id: 'u2' },
        ],
        'requester',
        'actor',
      ),
    ).toEqual(['u1', 'u2']);
  });

  it('leaves out the requester and the user who added the reviewers (Req 20.1)', () => {
    expect(
      selectReviewRequestRecipientIds(
        [
          { kind: 'user', id: 'requester' },
          { kind: 'user', id: 'actor' },
          { kind: 'user', id: 'u1' },
          { kind: 'user', id: 'u1' },
        ],
        'requester',
        'actor',
      ),
    ).toEqual(['u1']);
  });
});

describe('buildReviewRequestPages', () => {
  const pagePaths = new Map([
    ['p1', '/one'],
    ['p2', '/two'],
  ]);

  it('lists only the decision targets, a create by the path it would create (Req 20.3)', () => {
    const operations = [
      edit('k1', 'p1'),
      edit('k2', 'p2'),
      create('k3', '/new'),
    ];

    expect(
      buildReviewRequestPages(operations, new Set(['k1', 'k3']), pagePaths),
    ).toEqual([{ id: 'p1', path: '/one' }, { path: '/new' }]);
  });

  it('lists a page once even when several targets act on it', () => {
    const operations = [edit('k1', 'p1'), move('k2', 'p1')];

    expect(
      buildReviewRequestPages(operations, new Set(['k1', 'k2']), pagePaths),
    ).toEqual([{ id: 'p1', path: '/one' }]);
  });

  it('leaves out a target whose page path is unknown rather than guessing one', () => {
    expect(
      buildReviewRequestPages(
        [edit('k1', 'missing')],
        new Set(['k1']),
        pagePaths,
      ),
    ).toEqual([]);
  });
});

describe('buildReviewResultContent', () => {
  const pagePaths = new Map([['p1', '/one']]);
  const operations = [
    edit('k1', 'p1', 'applied'),
    edit('hidden', 'p-hidden'),
    create('k3', '/new'),
  ];

  it('builds items from the decided operations the requester sees, with the comment (Req 20.5)', () => {
    expect(
      buildReviewResultContent(
        operations,
        {
          kind: 'operations',
          result: 'rejected',
          operationKeys: ['k1', 'hidden', 'k3'],
          comment: 'please fix',
        },
        new Set(['k1', 'k3']),
        pagePaths,
      ),
    ).toEqual({
      items: [
        { path: '/one', result: 'rejected', comment: 'please fix' },
        { path: '/new', result: 'rejected', comment: 'please fix' },
      ],
    });
  });

  it('omits the comment when none was given', () => {
    expect(
      buildReviewResultContent(
        operations,
        { kind: 'operations', result: 'approved', operationKeys: ['k1'] },
        new Set(['k1']),
        pagePaths,
      ),
    ).toEqual({ items: [{ path: '/one', result: 'approved' }] });
  });

  it('builds nothing when no decided operation is one the requester sees', () => {
    expect(
      buildReviewResultContent(
        operations,
        { kind: 'operations', result: 'approved', operationKeys: ['hidden'] },
        new Set(['k1', 'k3']),
        pagePaths,
      ),
    ).toBeNull();
  });

  it('builds a whole-proposal rejection with no items, comment or not (Req 20.5)', () => {
    expect(
      buildReviewResultContent(
        operations,
        { kind: 'whole-rejection', comment: 'not now' },
        new Set(['k1', 'k3']),
        pagePaths,
      ),
    ).toEqual({ items: [], wholeRejection: { comment: 'not now' } });
    expect(
      buildReviewResultContent(
        operations,
        { kind: 'whole-rejection' },
        new Set(),
        pagePaths,
      ),
    ).toEqual({ items: [], wholeRejection: {} });
  });
});
