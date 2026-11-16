import type { OperationRecord } from '../../interfaces';
import { deriveProposalStatus } from './derive-proposal-status';
import { deriveVisibleStage } from './derive-visible-stage';

type Op = Pick<OperationRecord, 'status' | 'reason'>;

const pending: Op = { status: 'pending' };
const failed: Op = { status: 'failed' };
const skipped = (reason: NonNullable<Op['reason']>): Op => ({
  status: 'skipped',
  reason,
});

describe('deriveVisibleStage', () => {
  it('is open when a visible operation is pending (Reviewers Req 5.1)', () => {
    expect(deriveVisibleStage([failed, pending])).toBe('open');
  });

  it('prefers open over a skipped reason when both are visible (Reviewers Req 2.9)', () => {
    expect(deriveVisibleStage([pending, skipped('expired')])).toBe('open');
  });

  it.each([
    'expired',
    'discarded',
    'withdrawn',
  ] as const)('is %s when no visible operation is pending and a visible operation was skipped for that reason (Reviewers Req 2.9)', (reason) => {
    expect(deriveVisibleStage([failed, skipped(reason)])).toBe(reason);
  });

  it('is settled when nothing visible is pending or skipped for a closing reason (Reviewers Req 4.8)', () => {
    expect(deriveVisibleStage([failed])).toBe('settled');
    expect(deriveVisibleStage([{ status: 'applied' }])).toBe('settled');
    expect(deriveVisibleStage([])).toBe('settled');
  });

  it('ignores skipped reasons that are not a closing reason (Reviewers Req 2.9)', () => {
    expect(deriveVisibleStage([skipped('skipped-by-requester')])).toBe(
      'settled',
    );
    expect(deriveVisibleStage([skipped('page-being-edited')])).toBe('settled');
  });

  it('gives a failed-only view the same overall status as a one-operation proposal, whatever happened to hidden operations (Reviewers Req 5.6)', () => {
    // Hidden operations are never passed in, so closing the proposal cannot change the result.
    const visible = [failed];

    expect(deriveVisibleStage(visible)).toBe('settled');
    expect(deriveProposalStatus(deriveVisibleStage(visible), visible)).toBe(
      'not-applied',
    );
  });
});
