import { toRevisionProposalMark } from './to-revision-proposal-mark';

describe('toRevisionProposalMark', () => {
  it('maps operationKey to proposalOperationKey and carries no other field', () => {
    const mark = toRevisionProposalMark({
      proposalId: '65f000000000000000000001',
      operationKey: 'k-abc',
    });

    expect(mark).toStrictEqual({
      proposalId: '65f000000000000000000001',
      proposalOperationKey: 'k-abc',
    });
  });
});
