import * as domain from '.';

describe('change-proposal domain barrel', () => {
  it('exports the functions of the judgement files', () => {
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
        'selectNotifiedPageIds',
        'selectVisibleOperations',
        'shouldSendPerPageNotifications',
        'targetPageIdOf',
        'toRevisionProposalMark',
        'validateBasedOn',
        'validateProposalInput',
      ].sort(),
    );
    for (const fn of Object.values(domain)) {
      expect(typeof fn).toBe('function');
    }
  });
});
