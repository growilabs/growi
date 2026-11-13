import type { OperationRecord, OperationStatus } from '../../interfaces';
import {
  selectVisibleOperations,
  type VisibilityContext,
} from './select-visible-operations';

const STATUSES: readonly OperationStatus[] = [
  'pending',
  'applied',
  'failed',
  'stale',
  'skipped',
  'reverted',
  'revert-refused',
];
const OTHERS_VISIBLE: readonly OperationStatus[] = [
  'applied',
  'reverted',
  'revert-refused',
];
const OTHERS_HIDDEN = STATUSES.filter((s) => !OTHERS_VISIBLE.includes(s));

const editOp = (
  status: OperationStatus,
  pageId = 'p1',
  key = `k-${status}`,
): OperationRecord => ({
  index: 0,
  key,
  status,
  type: 'edit',
  pageId,
  baseRevisionId: 'r0',
  body: 'secret body',
  reason: status === 'failed' ? 'apply-failed' : undefined,
});

const createOp = (
  status: OperationStatus,
  resultPageId?: string,
): OperationRecord => ({
  index: 0,
  key: `c-${status}`,
  status,
  type: 'create',
  path: '/secret/path',
  body: 'secret body',
  resultPageId,
});

// The complete deletion a revert Change Proposal applies to undo a create.
const deleteCompletelyOp = (
  status: OperationStatus,
  pageId = 'p-gone',
): OperationRecord => ({
  index: 0,
  key: `d-${status}`,
  status,
  type: 'delete-completely',
  pageId,
  expectedRevisionId: 'r1',
  revertTarget: { proposalId: 'cp-original', operationKey: 'c-applied' },
});

const revertedBy = (
  op: OperationRecord,
  revertProposalId: string,
): OperationRecord => ({ ...op, revertedByProposalId: revertProposalId });

const ctx = (
  overrides: Partial<VisibilityContext> = {},
): VisibilityContext => ({
  isRequester: false,
  isOriginalRequester: false,
  revertProposalIdsByViewer: new Set(),
  viewablePageIds: new Set(['p1', 'p-new']),
  anyoneWithLinkPageIds: new Set(),
  deletedPageIds: new Set(),
  ...overrides,
});

describe('selectVisibleOperations', () => {
  describe('requester', () => {
    it.each(STATUSES)('keeps a %s operation on a viewable page', (status) => {
      const op = editOp(status);
      expect(selectVisibleOperations([op], ctx({ isRequester: true }))).toEqual(
        [op],
      );
    });

    it.each(
      STATUSES,
    )('drops a %s operation on a page the viewer cannot view', (status) => {
      expect(
        selectVisibleOperations(
          [editOp(status, 'p-hidden')],
          ctx({ isRequester: true }),
        ),
      ).toEqual([]);
    });

    it('keeps operations on anyone-with-link pages the requester can view', () => {
      const op = editOp('applied');
      expect(
        selectVisibleOperations(
          [op],
          ctx({
            isRequester: true,
            anyoneWithLinkPageIds: new Set(['p1']),
          }),
        ),
      ).toEqual([op]);
    });

    it.each(STATUSES)('keeps a %s create that has no page yet', (status) => {
      const op = createOp(status);
      expect(selectVisibleOperations([op], ctx({ isRequester: true }))).toEqual(
        [op],
      );
    });

    it('drops a create whose result page is not viewable', () => {
      expect(
        selectVisibleOperations(
          [createOp('applied', 'p-gone')],
          ctx({ isRequester: true }),
        ),
      ).toEqual([]);
    });
  });

  describe('non-requester', () => {
    it.each(
      OTHERS_VISIBLE,
    )('keeps a %s operation on a viewable page', (status) => {
      const op = editOp(status);
      expect(selectVisibleOperations([op], ctx())).toEqual([op]);
    });

    it.each(
      OTHERS_HIDDEN,
    )('drops a %s operation on a viewable page', (status) => {
      expect(selectVisibleOperations([editOp(status)], ctx())).toEqual([]);
    });

    it.each(
      STATUSES,
    )('drops a %s operation on a page the viewer cannot view', (status) => {
      expect(
        selectVisibleOperations([editOp(status, 'p-hidden')], ctx()),
      ).toEqual([]);
    });

    it.each(
      STATUSES,
    )('drops a %s operation on an anyone-with-link page', (status) => {
      expect(
        selectVisibleOperations(
          [editOp(status)],
          ctx({ anyoneWithLinkPageIds: new Set(['p1']) }),
        ),
      ).toEqual([]);
    });

    it.each(STATUSES)('drops a %s create that has no page yet', (status) => {
      expect(selectVisibleOperations([createOp(status)], ctx())).toEqual([]);
    });

    it('judges an applied create by its result page', () => {
      const op = createOp('applied', 'p-new');
      expect(selectVisibleOperations([op], ctx())).toEqual([op]);
      expect(
        selectVisibleOperations(
          [op],
          ctx({ anyoneWithLinkPageIds: new Set(['p-new']) }),
        ),
      ).toEqual([]);
      expect(
        selectVisibleOperations([op], ctx({ viewablePageIds: new Set() })),
      ).toEqual([]);
    });

    it('leaks nothing from dropped operations', () => {
      const result = selectVisibleOperations(
        [
          editOp('pending'),
          editOp('failed'),
          createOp('stale'),
          editOp('applied', 'p-hidden'),
        ],
        ctx(),
      );
      expect(result).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('secret');
    });
  });

  describe('an operation whose page was deleted completely', () => {
    const deleted = ctx({
      viewablePageIds: new Set(),
      deletedPageIds: new Set(['p-gone']),
    });

    it.each(
      STATUSES,
    )('is kept for the requester (%s), like a create that has no page yet', (status) => {
      const ops = [editOp(status, 'p-gone'), createOp(status, 'p-gone')];
      expect(
        selectVisibleOperations(ops, { ...deleted, isRequester: true }),
      ).toEqual(ops);
    });

    it.each(STATUSES)('is dropped for anyone else (%s)', (status) => {
      expect(
        selectVisibleOperations(
          [editOp(status, 'p-gone'), createOp(status, 'p-gone')],
          deleted,
        ),
      ).toEqual([]);
    });

    it.each(
      STATUSES,
    )('is judged as before when it is marked reverted but the viewer is no counterpart (%s)', (status) => {
      const ops = [
        revertedBy(createOp(status, 'p-gone'), 'rev-1'),
        revertedBy(editOp(status, 'p-gone'), 'rev-1'),
      ];
      expect(
        selectVisibleOperations(ops, { ...deleted, isRequester: true }),
      ).toEqual(ops);
      expect(selectVisibleOperations(ops, deleted)).toEqual([]);
    });

    describe('for a revert counterpart', () => {
      // Viewing a revert Change Proposal whose original the viewer requested.
      const originalRequester: VisibilityContext = {
        ...deleted,
        isOriginalRequester: true,
      };
      // Viewing an original Change Proposal one of whose operations the viewer reverted.
      const reverter: VisibilityContext = {
        ...deleted,
        revertProposalIdsByViewer: new Set(['rev-mine']),
      };

      it.each(
        OTHERS_VISIBLE,
      )('keeps a %s operation of the revert Change Proposal for the original requester', (status) => {
        const ops = [deleteCompletelyOp(status), editOp(status, 'p-gone')];
        expect(selectVisibleOperations(ops, originalRequester)).toEqual(ops);
      });

      it.each(
        OTHERS_VISIBLE,
      )('keeps a %s operation of the original Change Proposal for the reverter', (status) => {
        const ops = [
          revertedBy(createOp(status, 'p-gone'), 'rev-mine'),
          revertedBy(editOp(status, 'p-gone'), 'rev-mine'),
        ];
        expect(selectVisibleOperations(ops, reverter)).toEqual(ops);
      });

      it.each(OTHERS_HIDDEN)('drops a %s operation', (status) => {
        expect(
          selectVisibleOperations(
            [deleteCompletelyOp(status), editOp(status, 'p-gone')],
            originalRequester,
          ),
        ).toEqual([]);
        expect(
          selectVisibleOperations(
            [
              revertedBy(createOp(status, 'p-gone'), 'rev-mine'),
              revertedBy(editOp(status, 'p-gone'), 'rev-mine'),
            ],
            reverter,
          ),
        ).toEqual([]);
      });

      it.each(
        STATUSES,
      )('drops a %s operation reverted by a revert Change Proposal the viewer did not request', (status) => {
        expect(
          selectVisibleOperations(
            [
              revertedBy(createOp(status, 'p-gone'), 'rev-other'),
              editOp(status, 'p-gone'),
            ],
            reverter,
          ),
        ).toEqual([]);
      });

      it('keeps the requester seeing every status', () => {
        const ops = STATUSES.map((status) => deleteCompletelyOp(status));
        expect(
          selectVisibleOperations(ops, {
            ...originalRequester,
            isRequester: true,
          }),
        ).toEqual(ops);
      });
    });
  });

  describe('counterpart values outside a deleted page', () => {
    const counterpart = ctx({
      isOriginalRequester: true,
      revertProposalIdsByViewer: new Set(['rev-mine']),
    });

    it.each(
      STATUSES,
    )('keep a %s create that has no page yet for the requester only', (status) => {
      const op = revertedBy(createOp(status), 'rev-mine');
      expect(selectVisibleOperations([op], counterpart)).toEqual([]);
      expect(
        selectVisibleOperations([op], { ...counterpart, isRequester: true }),
      ).toEqual([op]);
    });

    it.each(
      OTHERS_HIDDEN,
    )('do not reveal a %s operation on a viewable page', (status) => {
      expect(
        selectVisibleOperations(
          [revertedBy(editOp(status), 'rev-mine')],
          counterpart,
        ),
      ).toEqual([]);
    });

    it.each(
      STATUSES,
    )('do not reveal a %s operation on a page the viewer cannot view', (status) => {
      expect(
        selectVisibleOperations(
          [
            revertedBy(editOp(status, 'p-hidden'), 'rev-mine'),
            deleteCompletelyOp(status, 'p-hidden'),
          ],
          counterpart,
        ),
      ).toEqual([]);
    });

    it.each(
      STATUSES,
    )('do not reveal a %s operation on an anyone-with-link page', (status) => {
      expect(
        selectVisibleOperations([revertedBy(editOp(status), 'rev-mine')], {
          ...counterpart,
          anyoneWithLinkPageIds: new Set(['p1']),
        }),
      ).toEqual([]);
    });

    it.each(
      OTHERS_VISIBLE,
    )('keep a %s operation on a viewable page as for anyone else', (status) => {
      const op = revertedBy(editOp(status), 'rev-mine');
      expect(selectVisibleOperations([op], counterpart)).toEqual([op]);
    });
  });

  it('preserves order, keeps only the visible subset and does not mutate input', () => {
    const ops = [
      editOp('applied', 'p1', 'a'),
      editOp('pending', 'p1', 'b'),
      editOp('reverted', 'p1', 'c'),
      editOp('applied', 'p-hidden', 'd'),
    ];
    const snapshot = [...ops];
    const result = selectVisibleOperations(ops, ctx());
    expect(result.map((o) => o.key)).toEqual(['a', 'c']);
    expect(ops).toEqual(snapshot);
  });
});
