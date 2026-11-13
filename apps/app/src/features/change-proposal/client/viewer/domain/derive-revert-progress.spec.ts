import type {
  ChangeProposalView,
  OperationStatus,
  OperationView,
  RevertResult,
} from '../../../interfaces';
import { deriveRevertProgress } from './derive-revert-progress';

const ORIGINAL_ID = 'original-proposal';
const REVERT_ID = 'revert-proposal';

const revertOperation = (
  key: string,
  status: OperationStatus,
  targetKey: string = key,
  targetProposalId: string = ORIGINAL_ID,
): OperationView => ({
  key: `revert-${key}`,
  type: 'edit',
  status,
  revertTarget: { proposalId: targetProposalId, operationKey: targetKey },
});

const revertProposal = (
  operations: readonly OperationView[],
): ChangeProposalView => ({
  id: REVERT_ID,
  requester: { id: 'u1', username: 'alice', name: 'Alice' },
  entry: 'revert',
  createdAt: '2026-11-12T00:00:00.000Z',
  status: 'pending',
  isRequester: true,
  operations,
});

const originalOperation = (
  key: string,
  status: OperationStatus,
  reason?: OperationView['reason'],
): OperationView => ({
  key,
  type: 'edit',
  status,
  ...(reason != null ? { reason } : {}),
});

const emptyResult: RevertResult = {
  revertProposalId: REVERT_ID,
  operations: [],
};

describe('deriveRevertProgress', () => {
  describe('a key present in the revert result', () => {
    it('uses the reverted outcome as is', () => {
      const { entries, isSettled } = deriveRevertProgress({
        originalProposalId: ORIGINAL_ID,
        sentKeys: ['a'],
        result: {
          revertProposalId: REVERT_ID,
          operations: [{ key: 'a', outcome: 'reverted' }],
        },
        revertProposal: null,
        originalOperations: [],
      });

      expect(entries).toEqual([{ key: 'a', state: 'reverted' }]);
      expect(isSettled).toBe(true);
    });

    it('keeps the refusal reason of a revert-refused outcome', () => {
      const { entries } = deriveRevertProgress({
        originalProposalId: ORIGINAL_ID,
        sentKeys: ['a'],
        result: {
          operations: [
            { key: 'a', outcome: 'revert-refused', reason: 'has-children' },
          ],
        },
        revertProposal: null,
        originalOperations: [],
      });

      expect(entries).toEqual([
        { key: 'a', state: 'revert-refused', reason: 'has-children' },
      ]);
    });

    it('keeps the reason of a skipped outcome', () => {
      const { entries } = deriveRevertProgress({
        originalProposalId: ORIGINAL_ID,
        sentKeys: ['a'],
        result: {
          operations: [
            { key: 'a', outcome: 'skipped', reason: 'page-being-edited' },
          ],
        },
        revertProposal: null,
        originalOperations: [],
      });

      expect(entries).toEqual([
        { key: 'a', state: 'skipped', reason: 'page-being-edited' },
      ]);
    });

    it('prefers the result over the revert proposal operation', () => {
      const { entries } = deriveRevertProgress({
        originalProposalId: ORIGINAL_ID,
        sentKeys: ['a'],
        result: {
          revertProposalId: REVERT_ID,
          operations: [{ key: 'a', outcome: 'reverted' }],
        },
        revertProposal: revertProposal([revertOperation('a', 'pending')]),
        originalOperations: [],
      });

      expect(entries).toEqual([{ key: 'a', state: 'reverted' }]);
    });
  });

  describe('a key absent from the result', () => {
    const derive = (
      status: OperationStatus,
      originalOperations: readonly OperationView[] = [],
    ) =>
      deriveRevertProgress({
        originalProposalId: ORIGINAL_ID,
        sentKeys: ['a'],
        result: emptyResult,
        revertProposal: revertProposal([revertOperation('a', status)]),
        originalOperations,
      });

    it('is in progress while the revert operation is pending', () => {
      const { entries, isSettled } = derive('pending');

      expect(entries).toEqual([{ key: 'a', state: 'in-progress' }]);
      expect(isSettled).toBe(false);
    });

    it.each<OperationStatus>([
      'applied',
      'reverted',
      'revert-refused',
    ])('is reverted when the revert operation is %s', (status) => {
      const { entries, isSettled } = derive(status);

      expect(entries).toEqual([{ key: 'a', state: 'reverted' }]);
      expect(isSettled).toBe(true);
    });

    it('is skipped for page-being-edited when the revert operation is skipped', () => {
      expect(derive('skipped').entries).toEqual([
        { key: 'a', state: 'skipped', reason: 'page-being-edited' },
      ]);
    });

    it.each<OperationStatus>([
      'failed',
      'stale',
    ])('is refused without a reason when the revert operation is %s and the original has none', (status) => {
      const { entries, isSettled } = derive(status, [
        originalOperation('a', 'applied'),
      ]);

      expect(entries).toEqual([{ key: 'a', state: 'revert-refused' }]);
      expect(isSettled).toBe(true);
    });

    it('attaches the reason recorded on the original revert-refused operation', () => {
      const { entries } = derive('failed', [
        originalOperation('a', 'revert-refused', 'edited-after-apply'),
      ]);

      expect(entries).toEqual([
        { key: 'a', state: 'revert-refused', reason: 'edited-after-apply' },
      ]);
    });

    it('does not attach a reason when the original operation is not revert-refused', () => {
      const { entries } = derive('stale', [
        originalOperation('a', 'applied', 'has-children'),
      ]);

      expect(entries).toEqual([{ key: 'a', state: 'revert-refused' }]);
    });

    it('does not attach a reason that is not a revert refusal reason', () => {
      const { entries } = derive('failed', [
        originalOperation('a', 'revert-refused', 'path-occupied'),
      ]);

      expect(entries).toEqual([{ key: 'a', state: 'revert-refused' }]);
    });

    it('does not attach a reason taken from another key', () => {
      const { entries } = derive('failed', [
        originalOperation('b', 'revert-refused', 'has-children'),
      ]);

      expect(entries).toEqual([{ key: 'a', state: 'revert-refused' }]);
    });
  });

  describe('before the first refetch response', () => {
    it('is in progress when the revert proposal is not fetched yet', () => {
      const { entries, isSettled } = deriveRevertProgress({
        originalProposalId: ORIGINAL_ID,
        sentKeys: ['a'],
        result: emptyResult,
        revertProposal: null,
        originalOperations: [],
      });

      expect(entries).toEqual([{ key: 'a', state: 'in-progress' }]);
      expect(isSettled).toBe(false);
    });
  });

  describe('not targeted', () => {
    it('is not targeted when the result has no revert proposal id', () => {
      const { entries, isSettled } = deriveRevertProgress({
        originalProposalId: ORIGINAL_ID,
        sentKeys: ['a'],
        result: { operations: [] },
        revertProposal: null,
        originalOperations: [],
      });

      expect(entries).toEqual([{ key: 'a', state: 'not-targeted' }]);
      expect(isSettled).toBe(true);
    });

    it('is not targeted when no revert operation is tied to the key', () => {
      const { entries, isSettled } = deriveRevertProgress({
        originalProposalId: ORIGINAL_ID,
        sentKeys: ['a'],
        result: emptyResult,
        revertProposal: revertProposal([revertOperation('b', 'pending')]),
        originalOperations: [],
      });

      expect(entries).toEqual([{ key: 'a', state: 'not-targeted' }]);
      expect(isSettled).toBe(true);
    });

    it('is not targeted when the same key belongs to another proposal', () => {
      const { entries } = deriveRevertProgress({
        originalProposalId: ORIGINAL_ID,
        sentKeys: ['a'],
        result: emptyResult,
        revertProposal: revertProposal([
          revertOperation('a', 'applied', 'a', 'someone-elses-proposal'),
        ]),
        originalOperations: [],
      });

      expect(entries).toEqual([{ key: 'a', state: 'not-targeted' }]);
    });

    it('is not targeted when the revert operation has no revert target', () => {
      const { entries } = deriveRevertProgress({
        originalProposalId: ORIGINAL_ID,
        sentKeys: ['a'],
        result: emptyResult,
        revertProposal: revertProposal([originalOperation('a', 'applied')]),
        originalOperations: [],
      });

      expect(entries).toEqual([{ key: 'a', state: 'not-targeted' }]);
    });
  });

  describe('several keys', () => {
    it('returns one entry per sent key in the sent order and is settled only when none is in progress', () => {
      const args = {
        originalProposalId: ORIGINAL_ID,
        sentKeys: ['c', 'a', 'b'],
        result: {
          revertProposalId: REVERT_ID,
          operations: [{ key: 'a', outcome: 'reverted' }],
        },
        originalOperations: [],
      } satisfies Omit<
        Parameters<typeof deriveRevertProgress>[0],
        'revertProposal'
      >;

      const pending = deriveRevertProgress({
        ...args,
        revertProposal: revertProposal([
          revertOperation('b', 'pending'),
          revertOperation('c', 'applied'),
        ]),
      });
      expect(pending.entries.map((e) => [e.key, e.state])).toEqual([
        ['c', 'reverted'],
        ['a', 'reverted'],
        ['b', 'in-progress'],
      ]);
      expect(pending.isSettled).toBe(false);

      const done = deriveRevertProgress({
        ...args,
        revertProposal: revertProposal([
          revertOperation('b', 'applied'),
          revertOperation('c', 'applied'),
        ]),
      });
      expect(done.isSettled).toBe(true);
    });

    it('is settled when no key was sent', () => {
      const { entries, isSettled } = deriveRevertProgress({
        originalProposalId: ORIGINAL_ID,
        sentKeys: [],
        result: emptyResult,
        revertProposal: null,
        originalOperations: [],
      });

      expect(entries).toEqual([]);
      expect(isSettled).toBe(true);
    });
  });
});
