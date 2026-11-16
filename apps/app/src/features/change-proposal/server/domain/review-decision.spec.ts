import type { OperationStatus } from '../../interfaces';
import { canApprove } from './review-decision';

const approvedAt = new Date('2026-01-01T00:00:00Z');

describe('canApprove', () => {
  it('accepts a pending operation that has not been approved yet (Reviewers Req 2.5)', () => {
    expect(canApprove({ status: 'pending' })).toEqual({ accepted: true });
  });

  it('reports the current status without accepting when the operation is already approved and waiting to be applied (Reviewers Req 2.5)', () => {
    expect(canApprove({ status: 'pending', approvedAt })).toEqual({
      accepted: false,
      currentStatus: 'pending',
      awaitingApply: true,
    });
  });

  it.each<OperationStatus>([
    'applied',
    'failed',
    'stale',
    'skipped',
    'reverted',
    'revert-refused',
  ])('reports the current status without accepting when the operation is %s (Reviewers Req 2.11)', (status) => {
    expect(canApprove({ status })).toEqual({
      accepted: false,
      currentStatus: status,
    });
  });

  it('does not flag awaitingApply for a non-pending operation even if approvedAt remains (Reviewers Req 2.11)', () => {
    expect(canApprove({ status: 'applied', approvedAt })).toEqual({
      accepted: false,
      currentStatus: 'applied',
    });
  });
});
