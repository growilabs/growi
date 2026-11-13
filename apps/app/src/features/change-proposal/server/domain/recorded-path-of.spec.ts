import { recordedPathOf } from './recorded-path-of';

const base = { index: 0, key: 'k', status: 'applied' } as const;

const createdPaths = new Map([['original-create', '/created/by/original']]);

describe('recordedPathOf', () => {
  it('returns the path a create operation created', () => {
    const op = { ...base, type: 'create', path: '/new', body: 'b' } as const;

    expect(recordedPathOf(op, createdPaths)).toBe('/new');
  });

  it('returns the destination path of a move operation', () => {
    const op = {
      ...base,
      type: 'move',
      pageId: 'p',
      fromPath: '/from',
      toPath: '/to',
    } as const;

    expect(recordedPathOf(op, createdPaths)).toBe('/to');
  });

  describe('edit', () => {
    const edit = {
      ...base,
      type: 'edit',
      pageId: 'p',
      baseRevisionId: 'r',
      body: 'b',
    } as const;

    it('returns the page path recorded when the edit was applied', () => {
      const op = { ...edit, appliedPagePath: '/applied/here' };

      expect(recordedPathOf(op, createdPaths)).toBe('/applied/here');
    });

    it('returns none when the edit was applied before paths were recorded', () => {
      expect(recordedPathOf(edit, createdPaths)).toBeUndefined();
    });
  });

  describe('delete-completely', () => {
    const deleteCompletely = {
      ...base,
      type: 'delete-completely',
      pageId: 'p',
      expectedRevisionId: 'r',
    } as const;

    it('returns the path of the original create it reverts', () => {
      const op = {
        ...deleteCompletely,
        revertTarget: { proposalId: 'orig', operationKey: 'original-create' },
      };

      expect(recordedPathOf(op, createdPaths)).toBe('/created/by/original');
    });

    it('returns none when the original create cannot be found', () => {
      const op = {
        ...deleteCompletely,
        revertTarget: { proposalId: 'orig', operationKey: 'missing' },
      };

      expect(recordedPathOf(op, createdPaths)).toBeUndefined();
    });

    it('returns none when it has no revert target', () => {
      expect(recordedPathOf(deleteCompletely, createdPaths)).toBeUndefined();
    });
  });
});
