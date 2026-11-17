import type { OperationRecord } from '../../interfaces';
import {
  type AutoApplyPageFacts,
  isOwnPageForAutoApply,
  selectAutoApplyTargets,
} from './select-auto-apply-targets';

const base = (index: number) => ({
  index,
  key: `k${index}`,
  status: 'pending' as const,
});

const ops: OperationRecord[] = [
  { ...base(0), type: 'edit', pageId: 'mine', baseRevisionId: 'r', body: 'b' },
  {
    ...base(1),
    type: 'edit',
    pageId: 'theirs',
    baseRevisionId: 'r',
    body: 'b',
  },
  { ...base(2), type: 'create', path: '/new', body: 'b' },
  { ...base(3), type: 'move', pageId: 'mine', fromPath: '/a', toPath: '/b' },
  { ...base(4), type: 'move', pageId: 'theirs', fromPath: '/c', toPath: '/d' },
  {
    ...base(5),
    type: 'edit',
    pageId: 'unknown',
    baseRevisionId: 'r',
    body: 'b',
  },
];

const facts = new Map<string, AutoApplyPageFacts>([
  ['mine', { pageId: 'mine', creatorId: 'u1', lastUpdateUserId: 'u2' }],
  ['theirs', { pageId: 'theirs', creatorId: 'u2', lastUpdateUserId: 'u1' }],
]);

describe('isOwnPageForAutoApply', () => {
  it('is true when the creator is the requester', () => {
    expect(
      isOwnPageForAutoApply(
        { pageId: 'p', creatorId: 'u1', lastUpdateUserId: 'u2' },
        'u1',
      ),
    ).toBe(true);
  });

  it('is false for another creator, even if the requester updated it last', () => {
    expect(
      isOwnPageForAutoApply(
        { pageId: 'p', creatorId: 'u2', lastUpdateUserId: 'u1' },
        'u1',
      ),
    ).toBe(false);
  });

  it('is false when the creator is unknown', () => {
    expect(
      isOwnPageForAutoApply(
        { pageId: 'p', creatorId: null, lastUpdateUserId: 'u1' },
        'u1',
      ),
    ).toBe(false);
  });
});

describe('selectAutoApplyTargets', () => {
  it("selects nothing for policy 'none'", () => {
    expect(selectAutoApplyTargets('none', ops, facts, 'u1', null)).toEqual([]);
  });

  it("selects every operation for policy 'all'", () => {
    expect(selectAutoApplyTargets('all', ops, facts, 'u1', null)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  describe("policy 'own-pages'", () => {
    const selected = selectAutoApplyTargets(
      'own-pages',
      ops,
      facts,
      'u1',
      null,
    );

    it('selects operations on pages the requester created', () => {
      expect(selected).toContain(0);
    });

    it('always selects creates', () => {
      expect(selected).toContain(2);
    });

    it('judges a move by its source page', () => {
      expect(selected).toContain(3);
      expect(selected).not.toContain(4);
    });

    it("leaves other people's pages and pages without facts pending", () => {
      expect(selected).not.toContain(1);
      expect(selected).not.toContain(5);
    });

    it('returns exactly the expected set', () => {
      expect(selected).toEqual([0, 2, 3]);
    });
  });

  it('selects only creates for own-pages when the requester owns nothing', () => {
    expect(
      selectAutoApplyTargets('own-pages', ops, new Map(), 'u1', null),
    ).toEqual([2]);
  });

  describe.each([
    'none',
    'own-pages',
    'all',
  ] as const)('relation with policy %s', (policy) => {
    it('selects nothing for a rework', () => {
      expect(
        selectAutoApplyTargets(policy, ops, facts, 'u1', 'rework'),
      ).toEqual([]);
    });

    it('follows the policy for a follow-up', () => {
      expect(
        selectAutoApplyTargets(policy, ops, facts, 'u1', 'follow-up'),
      ).toEqual(selectAutoApplyTargets(policy, ops, facts, 'u1', null));
    });
  });

  it('returns an empty list for no operations', () => {
    expect(selectAutoApplyTargets('all', [], facts, 'u1', null)).toEqual([]);
  });
});
