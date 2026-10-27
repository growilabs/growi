import type { FailureReason, RevertRefusalReason } from '../../interfaces';
import type { RecordedOutcome } from '../models/change-proposal-types';
import { toOriginalOperationChange } from './to-original-operation-change';

const REVERT_ID = 'revert-proposal-id';
const NOW = new Date('2026-10-27T00:00:00Z');

const failed = (reason: FailureReason): RecordedOutcome => ({
  status: 'failed',
  reason,
});

describe('toOriginalOperationChange', () => {
  it('marks the original operation reverted by this revert proposal when the revert operation is applied', () => {
    expect(
      toOriginalOperationChange(
        { status: 'applied', resultPageId: 'p1', resultRevisionId: 'r1' },
        REVERT_ID,
        NOW,
      ),
    ).toEqual({
      status: 'reverted',
      revertedByProposalId: REVERT_ID,
      revertedAt: NOW,
    });
  });

  it('refuses with edited-after-apply when the revert operation is stale', () => {
    expect(
      toOriginalOperationChange(
        { status: 'stale', reason: 'base-revision-changed' },
        REVERT_ID,
        NOW,
      ),
    ).toEqual({ status: 'revert-refused', reason: 'edited-after-apply' });
  });

  it.each<RevertRefusalReason>([
    'not-revertible-state',
    'target-unavailable',
    'edited-after-apply',
    'has-children',
    'moved-after-apply',
    'original-path-occupied',
    'not-in-trash',
    'page-operation-in-progress',
    'apply-failed',
  ])('keeps the failure reason %s, which is already a refusal reason', (reason) => {
    expect(toOriginalOperationChange(failed(reason), REVERT_ID, NOW)).toEqual({
      status: 'revert-refused',
      reason,
    });
  });

  it('maps path-occupied to original-path-occupied', () => {
    expect(
      toOriginalOperationChange(failed('path-occupied'), REVERT_ID, NOW),
    ).toEqual({ status: 'revert-refused', reason: 'original-path-occupied' });
  });

  it.each<FailureReason>([
    'write-error',
    'requester-not-allowed',
    'grant-not-assignable',
    'feature-disabled',
    'operation-type-disabled',
  ])('maps the other failure reason %s to apply-failed', (reason) => {
    expect(toOriginalOperationChange(failed(reason), REVERT_ID, NOW)).toEqual({
      status: 'revert-refused',
      reason: 'apply-failed',
    });
  });

  it.each<RecordedOutcome>([
    { status: 'skipped', reason: 'page-being-edited' },
    { status: 'pending', reason: 'page-being-edited' },
    { status: 'pending', reason: 'page-operation-in-progress' },
  ])('leaves the original operation as it is for $status / $reason', (outcome) => {
    expect(toOriginalOperationChange(outcome, REVERT_ID, NOW)).toBeNull();
  });
});
