import type { OperationRecord } from '../../interfaces';
import { buildRevertOperations } from './build-revert-operations';

const applied = { status: 'applied' as const };

const editOp: OperationRecord = {
  ...applied,
  index: 0,
  key: 'k-edit',
  type: 'edit',
  pageId: 'p-edit',
  baseRevisionId: 'r-base',
  body: 'ai body',
  resultPageId: 'p-edit',
  resultRevisionId: 'r-edit-applied',
};
const createOp: OperationRecord = {
  ...applied,
  index: 1,
  key: 'k-create',
  type: 'create',
  path: '/new',
  body: 'body',
  resultPageId: 'p-new',
  resultRevisionId: 'r-created',
};
const moveOp: OperationRecord = {
  ...applied,
  index: 2,
  key: 'k-move',
  type: 'move',
  pageId: 'p-move',
  fromPath: '/from',
  toPath: '/to',
  resultPageId: 'p-move',
};

const original = Object.freeze({
  proposalId: 'cp-orig',
  operations: Object.freeze([editOp, createOp, moveOp]),
});

describe('buildRevertOperations', () => {
  it('reverses an edit into an edit back to the original body on top of the applied revision (Req 5.5)', () => {
    const result = buildRevertOperations(original, [
      { key: 'k-edit', originalBody: 'original body' },
    ]);

    expect(result).toEqual([
      {
        type: 'edit',
        pageId: 'p-edit',
        baseRevisionId: 'r-edit-applied',
        body: 'original body',
        revertTarget: { proposalId: 'cp-orig', operationKey: 'k-edit' },
      },
    ]);
  });

  it('reverses a create into deleting the created page completely, expecting the created revision (Req 5.6)', () => {
    const result = buildRevertOperations(original, [{ key: 'k-create' }]);

    expect(result).toEqual([
      {
        type: 'delete-completely',
        pageId: 'p-new',
        expectedRevisionId: 'r-created',
        revertTarget: { proposalId: 'cp-orig', operationKey: 'k-create' },
      },
    ]);
  });

  it('reverses a move into a move back that removes the redirects from the original source (Req 5.7)', () => {
    const result = buildRevertOperations(original, [{ key: 'k-move' }]);

    expect(result).toEqual([
      {
        type: 'move',
        pageId: 'p-move',
        fromPath: '/to',
        toPath: '/from',
        removeRedirectsFrom: '/from',
        revertTarget: { proposalId: 'cp-orig', operationKey: 'k-move' },
      },
    ]);
  });

  it('returns only the revertible keys, in the stored order of the target, regardless of input order', () => {
    const result = buildRevertOperations(original, [
      { key: 'k-move' },
      { key: 'k-edit', originalBody: 'original body' },
    ]);

    expect(result.map((op) => op.revertTarget.operationKey)).toEqual([
      'k-edit',
      'k-move',
    ]);
  });

  it('returns nothing when no operation is revertible', () => {
    expect(buildRevertOperations(original, [])).toEqual([]);
  });

  describe('reverting a revert proposal', () => {
    const revertEdit: OperationRecord = {
      ...applied,
      index: 0,
      key: 'rk-edit',
      type: 'edit',
      pageId: 'p-edit',
      baseRevisionId: 'r-edit-applied',
      body: 'original body',
      resultPageId: 'p-edit',
      resultRevisionId: 'r-reverted',
      revertTarget: { proposalId: 'cp-orig', operationKey: 'k-edit' },
    };
    const revertMove: OperationRecord = {
      ...applied,
      index: 1,
      key: 'rk-move',
      type: 'move',
      pageId: 'p-move',
      fromPath: '/to',
      toPath: '/from',
      removeRedirectsFrom: '/from',
      resultPageId: 'p-move',
      revertTarget: { proposalId: 'cp-orig', operationKey: 'k-move' },
    };
    const revertDelete: OperationRecord = {
      ...applied,
      index: 2,
      key: 'rk-delete',
      type: 'delete-completely',
      pageId: 'p-new',
      expectedRevisionId: 'r-created',
      resultPageId: 'p-new',
      revertTarget: { proposalId: 'cp-orig', operationKey: 'k-create' },
    };
    const revertProposal = Object.freeze({
      proposalId: 'cp-revert',
      operations: Object.freeze([revertEdit, revertMove, revertDelete]),
    });

    it('reverses an edit in the same shape (Req 5.12)', () => {
      const result = buildRevertOperations(revertProposal, [
        { key: 'rk-edit', originalBody: 'ai body' },
      ]);

      expect(result).toEqual([
        {
          type: 'edit',
          pageId: 'p-edit',
          baseRevisionId: 'r-reverted',
          body: 'ai body',
          revertTarget: { proposalId: 'cp-revert', operationKey: 'rk-edit' },
        },
      ]);
    });

    it('reverses a move in the same shape (Req 5.12)', () => {
      const result = buildRevertOperations(revertProposal, [
        { key: 'rk-move' },
      ]);

      expect(result).toEqual([
        {
          type: 'move',
          pageId: 'p-move',
          fromPath: '/from',
          toPath: '/to',
          removeRedirectsFrom: '/to',
          revertTarget: { proposalId: 'cp-revert', operationKey: 'rk-move' },
        },
      ]);
    });

    it('throws for a complete deletion, which cannot be reverted (Req 5.15)', () => {
      expect(() =>
        buildRevertOperations(revertProposal, [{ key: 'rk-delete' }]),
      ).toThrow(/cannot be reverted/);
    });
  });

  describe('missing facts', () => {
    it('throws for a key that is not in the target', () => {
      expect(() =>
        buildRevertOperations(original, [{ key: 'unknown' }]),
      ).toThrow(/not in proposal/);
    });

    it('throws for an edit without its original body', () => {
      expect(() =>
        buildRevertOperations(original, [{ key: 'k-edit' }]),
      ).toThrow(/missing originalBody/);
    });

    it('throws for an applied create without the created page or revision', () => {
      const { resultRevisionId: _omitted, ...withoutRevision } = createOp;

      expect(() =>
        buildRevertOperations(
          { proposalId: 'cp', operations: [withoutRevision] },
          [{ key: 'k-create' }],
        ),
      ).toThrow(/missing resultRevisionId/);
    });

    it('throws for an applied edit without the applied revision', () => {
      const { resultRevisionId: _omitted, ...withoutRevision } = editOp;

      expect(() =>
        buildRevertOperations(
          { proposalId: 'cp', operations: [withoutRevision] },
          [{ key: 'k-edit', originalBody: 'b' }],
        ),
      ).toThrow(/missing resultRevisionId/);
    });
  });
});
