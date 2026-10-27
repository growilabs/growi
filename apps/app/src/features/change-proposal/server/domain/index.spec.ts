import * as domain from '.';

describe('change-proposal domain barrel', () => {
  it('exports the functions of the 12 judgement files', () => {
    expect(Object.keys(domain).sort()).toEqual(
      [
        'buildProposalLinks',
        'buildRevertOperations',
        'computeAchievement',
        'deriveProposalStatus',
        'expandApprovalTargets',
        'isOwnPageForAutoApply',
        'judgeRevertability',
        'planApplyOrder',
        'selectAutoApplyTargets',
        'selectVisibleOperations',
        'shouldSendPerPageNotifications',
        'validateBasedOn',
        'validateProposalInput',
      ].sort(),
    );
    for (const fn of Object.values(domain)) {
      expect(typeof fn).toBe('function');
    }
  });
});
