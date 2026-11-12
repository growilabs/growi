import type {
  BasedOn,
  BasedOnRelation,
  ChangeProposalDocument,
  OperationRecord,
  OperationStatus,
  ProposalEntry,
} from '../../interfaces';
import { validateBasedOn } from './validate-based-on';

const REQUESTER = 'user-1';

const op = (key: string, status: OperationStatus): OperationRecord =>
  ({
    index: 0,
    key,
    type: 'edit',
    pageId: `page-${key}`,
    status,
  }) as OperationRecord;

type Base = Pick<ChangeProposalDocument, 'requester' | 'entry' | 'operations'>;
const base = (
  operations: readonly OperationRecord[],
  overrides: Partial<Base> = {},
): Base => ({
  requester: REQUESTER,
  entry: 'ai-chat',
  operations,
  ...overrides,
});

const basedOn = (
  relation: BasedOnRelation,
  operationKeys: readonly string[],
): BasedOn => ({ proposalId: 'base-1', relation, operationKeys });

const ALL_STATUSES: readonly OperationStatus[] = [
  'pending',
  'applied',
  'failed',
  'stale',
  'skipped',
  'reverted',
  'revert-refused',
];
const ELIGIBLE: Record<BasedOnRelation, readonly OperationStatus[]> = {
  'follow-up': ['stale', 'failed', 'skipped'],
  rework: ['applied', 'revert-refused'],
};

describe('validateBasedOn', () => {
  describe('base proposal availability', () => {
    it('rejects as unavailable when the base is missing', () => {
      expect(
        validateBasedOn(basedOn('follow-up', ['a']), null, REQUESTER),
      ).toEqual({ ok: false, rejection: { code: 'based-on-unavailable' } });
    });

    it('rejects as unavailable when the base belongs to another requester', () => {
      const result = validateBasedOn(
        basedOn('follow-up', ['a']),
        base([op('a', 'stale')], { requester: 'someone-else' }),
        REQUESTER,
      );
      expect(result).toEqual({
        ok: false,
        rejection: { code: 'based-on-unavailable' },
      });
    });

    it('rejects as unavailable when the base is a revert proposal', () => {
      const result = validateBasedOn(
        basedOn('follow-up', ['a']),
        base([op('a', 'stale')], { entry: 'revert' }),
        REQUESTER,
      );
      expect(result).toEqual({
        ok: false,
        rejection: { code: 'based-on-unavailable' },
      });
    });

    it('gives the same rejection for the three unavailable causes, even when keys are also bad', () => {
      const keys = basedOn('rework', []);
      const results = [
        validateBasedOn(keys, null, REQUESTER),
        validateBasedOn(keys, base([], { requester: 'x' }), REQUESTER),
        validateBasedOn(keys, base([], { entry: 'revert' }), REQUESTER),
      ];
      expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    });

    it.each([
      'ai-chat',
      'vault',
      'mcp',
    ] as ProposalEntry[])('accepts a base from the %s entry', (entry) => {
      const result = validateBasedOn(
        basedOn('follow-up', ['a']),
        base([op('a', 'stale')], { entry }),
        REQUESTER,
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('operation keys', () => {
    it.each([
      'follow-up',
      'rework',
    ] as BasedOnRelation[])('rejects an empty key list for %s without an operation key', (relation) => {
      expect(
        validateBasedOn(
          basedOn(relation, []),
          base([op('a', 'stale')]),
          REQUESTER,
        ),
      ).toEqual({
        ok: false,
        rejection: { code: 'based-on-operation-not-eligible' },
      });
    });

    it('rejects a key that is not in the base and names it', () => {
      expect(
        validateBasedOn(
          basedOn('follow-up', ['a', 'missing']),
          base([op('a', 'stale')]),
          REQUESTER,
        ),
      ).toEqual({
        ok: false,
        rejection: {
          code: 'based-on-operation-not-eligible',
          operationKey: 'missing',
        },
      });
    });

    it('names the first offending key in request order', () => {
      expect(
        validateBasedOn(
          basedOn('follow-up', ['a', 'bad-2', 'bad-1']),
          base([
            op('a', 'stale'),
            op('bad-1', 'applied'),
            op('bad-2', 'pending'),
          ]),
          REQUESTER,
        ),
      ).toEqual({
        ok: false,
        rejection: {
          code: 'based-on-operation-not-eligible',
          operationKey: 'bad-2',
        },
      });
    });

    it('rejects when one key is ineligible even if others are eligible', () => {
      const result = validateBasedOn(
        basedOn('follow-up', ['a', 'b']),
        base([op('a', 'stale'), op('b', 'applied')]),
        REQUESTER,
      );
      expect(result).toEqual({
        ok: false,
        rejection: {
          code: 'based-on-operation-not-eligible',
          operationKey: 'b',
        },
      });
    });

    it('de-duplicates repeated keys keeping first occurrence order', () => {
      const result = validateBasedOn(
        basedOn('follow-up', ['b', 'a', 'b', 'a']),
        base([op('a', 'stale'), op('b', 'failed')]),
        REQUESTER,
      );
      expect(result).toEqual({
        ok: true,
        basedOn: basedOn('follow-up', ['b', 'a']),
      });
    });

    it('returns the proposal id and relation unchanged', () => {
      const result = validateBasedOn(
        { proposalId: 'p-9', relation: 'rework', operationKeys: ['a'] },
        base([op('a', 'applied')]),
        REQUESTER,
      );
      expect(result).toEqual({
        ok: true,
        basedOn: {
          proposalId: 'p-9',
          relation: 'rework',
          operationKeys: ['a'],
        },
      });
    });

    it('does not mutate its input', () => {
      const input = basedOn('follow-up', ['a', 'a']);
      validateBasedOn(input, base([op('a', 'stale')]), REQUESTER);
      expect(input.operationKeys).toEqual(['a', 'a']);
    });
  });

  describe.each(
    Object.keys(ELIGIBLE) as BasedOnRelation[],
  )('operation status for %s', (relation) => {
    it.each(
      ALL_STATUSES.map(
        (status) => [status, ELIGIBLE[relation].includes(status)] as const,
      ),
    )('status %s eligible=%s', (status, eligible) => {
      const result = validateBasedOn(
        basedOn(relation, ['a']),
        base([op('a', status)]),
        REQUESTER,
      );
      if (eligible) {
        expect(result).toEqual({ ok: true, basedOn: basedOn(relation, ['a']) });
      } else {
        expect(result).toEqual({
          ok: false,
          rejection: {
            code: 'based-on-operation-not-eligible',
            operationKey: 'a',
          },
        });
      }
    });
  });

  it('accepts skipped regardless of the skip reason for follow-up', () => {
    const skipped = (reason: OperationRecord['reason']): OperationRecord => ({
      ...op('a', 'skipped'),
      reason,
    });
    for (const reason of [
      'skipped-by-requester',
      'dependency-failed',
    ] as const) {
      const result = validateBasedOn(
        basedOn('follow-up', ['a']),
        base([skipped(reason as OperationRecord['reason'])]),
        REQUESTER,
      );
      expect(result.ok).toBe(true);
    }
  });
});
