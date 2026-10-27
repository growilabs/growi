import type { ChangeProposalDocument, OperationRecord } from '../../interfaces';
import { selectNotifiedPageIds } from './select-notified-page-ids';

const base = { index: 0, key: 'k' } as const;

const proposalWith = (
  entry: ChangeProposalDocument['entry'],
  operations: readonly OperationRecord[],
): Pick<ChangeProposalDocument, 'entry' | 'operations'> => ({
  entry,
  operations,
});

const edit = (pageId: string, status: OperationRecord['status']) =>
  ({
    ...base,
    type: 'edit',
    pageId,
    baseRevisionId: 'r',
    body: 'b',
    status,
  }) as const;
const move = (pageId: string, status: OperationRecord['status']) =>
  ({
    ...base,
    type: 'move',
    pageId,
    fromPath: '/a',
    toPath: '/b',
    status,
  }) as const;
const trash = (pageId: string) =>
  ({
    ...base,
    type: 'trash',
    pageId,
    expectedRevisionId: 'r',
    status: 'applied',
  }) as const;
const restore = (pageId: string) =>
  ({
    ...base,
    type: 'restore',
    pageId,
    expectedRevisionId: 'r',
    toPath: '/p',
    status: 'applied',
  }) as const;
const create = {
  ...base,
  type: 'create',
  path: '/new',
  body: 'b',
  status: 'applied',
  resultPageId: 'created',
} as const;

describe('selectNotifiedPageIds', () => {
  it('takes the pages of applied edits and moves, never created pages or unapplied operations', () => {
    const proposal = proposalWith('ai-chat', [
      edit('p1', 'applied'),
      move('p2', 'applied'),
      create,
      edit('p3', 'stale'),
      move('p4', 'failed'),
      edit('p5', 'reverted'),
    ]);

    expect(selectNotifiedPageIds(proposal)).toEqual(['p1', 'p2']);
  });

  it('also takes applied trash and restore pages in a revert proposal', () => {
    const proposal = proposalWith('revert', [
      edit('p1', 'applied'),
      trash('p2'),
      restore('p3'),
      move('p4', 'skipped'),
    ]);

    expect(selectNotifiedPageIds(proposal)).toEqual(['p1', 'p2', 'p3']);
  });

  it('lists a page once even when several operations touched it', () => {
    const proposal = proposalWith('ai-chat', [
      edit('p1', 'applied'),
      move('p1', 'applied'),
    ]);

    expect(selectNotifiedPageIds(proposal)).toEqual(['p1']);
  });
});
