import type { OperationRecord, OperationStatus } from '../../interfaces';
import {
  type CurrentPageFacts,
  judgeRevertability,
} from './judge-revertability';

const facts = (
  overrides: Partial<CurrentPageFacts> = {},
): CurrentPageFacts => ({
  exists: true,
  path: null,
  latestRevisionId: null,
  hasChildren: false,
  canDelete: true,
  isPathOccupied: () => false,
  ...overrides,
});

type OpOf<T extends OperationRecord['type']> = Extract<
  OperationRecord,
  { type: T }
>;

const occupiedOnly =
  (occupied: string) =>
  (path: string): boolean =>
    path === occupied;

const common = (status: OperationStatus = 'applied') => ({
  index: 0,
  key: 'k0',
  status,
});

const editOp = (status?: OperationStatus): OpOf<'edit'> => ({
  ...common(status),
  type: 'edit',
  pageId: 'p1',
  baseRevisionId: 'r-base',
  body: 'new body',
  resultPageId: 'p1',
  resultRevisionId: 'r-applied',
});

const createOp = (status?: OperationStatus): OpOf<'create'> => ({
  ...common(status),
  type: 'create',
  path: '/new',
  body: 'body',
  resultPageId: 'p-new',
  resultRevisionId: 'r-created',
});

const moveOp = (status?: OperationStatus): OpOf<'move'> => ({
  ...common(status),
  type: 'move',
  pageId: 'p1',
  fromPath: '/from',
  toPath: '/to',
  resultPageId: 'p1',
});

const deleteCompletelyOp = (
  status?: OperationStatus,
): OpOf<'delete-completely'> => ({
  ...common(status),
  type: 'delete-completely',
  pageId: 'p-new',
  expectedRevisionId: 'r-created',
  resultPageId: 'p-new',
});

const refused = (reason: string) => ({ revertible: false, reason });

describe('judgeRevertability', () => {
  describe('state', () => {
    it.each<OperationStatus>([
      'pending',
      'failed',
      'stale',
      'skipped',
      'reverted',
    ])('refuses an operation whose status is %s with not-revertible-state, even when the page is gone', (status) => {
      const result = judgeRevertability(
        editOp(status),
        'ai-chat',
        facts({ exists: false }),
      );

      expect(result).toEqual(refused('not-revertible-state'));
    });

    it.each<OperationStatus>([
      'applied',
      'revert-refused',
    ])('accepts an operation whose status is %s when the page is unchanged', (status) => {
      const result = judgeRevertability(
        editOp(status),
        'ai-chat',
        facts({ path: '/page', latestRevisionId: 'r-applied' }),
      );

      expect(result).toEqual({ revertible: true });
    });
  });

  describe('missing page', () => {
    it.each([
      ['edit', editOp()],
      ['create', createOp()],
      ['move', moveOp()],
      ['delete-completely', deleteCompletelyOp()],
    ])('refuses %s with target-unavailable when the page does not exist', (_label, op) => {
      const result = judgeRevertability(
        op,
        'ai-chat',
        facts({ exists: false }),
      );

      expect(result).toEqual(refused('target-unavailable'));
    });
  });

  describe('edit (Req 5.5)', () => {
    it('is revertible while the revision it created is still the latest', () => {
      const result = judgeRevertability(
        editOp(),
        'ai-chat',
        facts({ path: '/page', latestRevisionId: 'r-applied' }),
      );

      expect(result).toEqual({ revertible: true });
    });

    it('refuses with edited-after-apply when a newer revision exists', () => {
      const result = judgeRevertability(
        editOp(),
        'ai-chat',
        facts({ path: '/page', latestRevisionId: 'r-later' }),
      );

      expect(result).toEqual(refused('edited-after-apply'));
    });

    it('applies the same rule to an edit made by a revert proposal (Req 5.12)', () => {
      const revertEdit: OperationRecord = {
        ...editOp(),
        revertTarget: { proposalId: 'cp-1', operationKey: 'k9' },
      };

      expect(
        judgeRevertability(
          revertEdit,
          'revert',
          facts({ latestRevisionId: 'r-applied' }),
        ),
      ).toEqual({ revertible: true });
      expect(
        judgeRevertability(
          revertEdit,
          'revert',
          facts({ latestRevisionId: 'r-later' }),
        ),
      ).toEqual(refused('edited-after-apply'));
    });
  });

  describe('create (Req 5.6)', () => {
    it('is revertible with no children and the created revision still latest', () => {
      const result = judgeRevertability(
        createOp(),
        'mcp',
        facts({ path: '/new', latestRevisionId: 'r-created' }),
      );

      expect(result).toEqual({ revertible: true });
    });

    it('refuses with has-children when the page has children', () => {
      const result = judgeRevertability(
        createOp(),
        'mcp',
        facts({ path: '/new', latestRevisionId: 'r-later', hasChildren: true }),
      );

      expect(result).toEqual(refused('has-children'));
    });

    it('refuses with edited-after-apply when a newer revision exists', () => {
      const result = judgeRevertability(
        createOp(),
        'mcp',
        facts({ path: '/new', latestRevisionId: 'r-later' }),
      );

      expect(result).toEqual(refused('edited-after-apply'));
    });
  });

  describe('move (Req 5.7)', () => {
    it('is revertible while the page stays at the destination and the source path is free', () => {
      const result = judgeRevertability(
        moveOp(),
        'vault',
        facts({ path: '/to', isPathOccupied: occupiedOnly('/elsewhere') }),
      );

      expect(result).toEqual({ revertible: true });
    });

    it('refuses with moved-after-apply when the page has moved away from the destination', () => {
      const result = judgeRevertability(
        moveOp(),
        'vault',
        facts({ path: '/moved-again' }),
      );

      expect(result).toEqual(refused('moved-after-apply'));
    });

    it('refuses with original-path-occupied when the source path is in use', () => {
      const result = judgeRevertability(
        moveOp(),
        'vault',
        facts({ path: '/to', isPathOccupied: occupiedOnly('/from') }),
      );

      expect(result).toEqual(refused('original-path-occupied'));
    });

    it('applies the same rule to a move made by a revert proposal (Req 5.12)', () => {
      const revertMove: OperationRecord = {
        ...moveOp(),
        fromPath: '/to',
        toPath: '/from',
        removeRedirectsFrom: '/from',
        revertTarget: { proposalId: 'cp-1', operationKey: 'k9' },
      };

      expect(
        judgeRevertability(revertMove, 'revert', facts({ path: '/from' })),
      ).toEqual({ revertible: true });
      expect(
        judgeRevertability(
          revertMove,
          'revert',
          facts({ path: '/from', isPathOccupied: occupiedOnly('/to') }),
        ),
      ).toEqual(refused('original-path-occupied'));
    });
  });

  describe('complete deletion made by a revert proposal (Req 5.15)', () => {
    it('refuses with target-unavailable, since the deleted page cannot be brought back', () => {
      expect(
        judgeRevertability(
          deleteCompletelyOp(),
          'revert',
          facts({ exists: false }),
        ),
      ).toEqual(refused('target-unavailable'));
    });

    it('refuses with target-unavailable even if a page with the same id were still found', () => {
      expect(
        judgeRevertability(
          deleteCompletelyOp(),
          'revert',
          facts({ path: '/new', latestRevisionId: 'r-created' }),
        ),
      ).toEqual(refused('target-unavailable'));
    });
  });

  describe("the viewer's delete authority", () => {
    it('refuses a create with not-deletable when the viewer may not delete the page completely', () => {
      const result = judgeRevertability(
        createOp(),
        'revert',
        facts({
          path: '/new',
          latestRevisionId: 'r-created',
          canDelete: false,
        }),
      );

      expect(result).toEqual(refused('not-deletable'));
    });

    it('reports has-children and edited-after-apply before not-deletable, in the delete-completely handler order', () => {
      expect(
        judgeRevertability(
          createOp(),
          'mcp',
          facts({
            path: '/new',
            latestRevisionId: 'r-created',
            hasChildren: true,
            canDelete: false,
          }),
        ),
      ).toEqual(refused('has-children'));
      expect(
        judgeRevertability(
          createOp(),
          'mcp',
          facts({
            path: '/new',
            latestRevisionId: 'r-later',
            canDelete: false,
          }),
        ),
      ).toEqual(refused('edited-after-apply'));
    });

    it('does not ask about delete authority for an edit or a move, whose reverts delete nothing', () => {
      expect(
        judgeRevertability(
          editOp(),
          'mcp',
          facts({ latestRevisionId: 'r-applied', canDelete: false }),
        ),
      ).toEqual({ revertible: true });
      expect(
        judgeRevertability(
          moveOp(),
          'mcp',
          facts({ path: '/to', canDelete: false }),
        ),
      ).toEqual({ revertible: true });
    });
  });
});
