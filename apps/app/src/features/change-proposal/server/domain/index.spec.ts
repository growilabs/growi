import * as domain from '.';

describe('change-proposal domain barrel', () => {
  it('exports the functions of the judgement files', () => {
    expect(Object.keys(domain).sort()).toEqual(
      [
        'buildProposalLinks',
        'buildRevertOperations',
        'collectCreatedPaths',
        'computeAchievement',
        'deriveProposalStatus',
        'expandApprovalTargets',
        'isMovableSourcePath',
        'isOwnPageForAutoApply',
        'judgeRevertability',
        'planApplyOrder',
        'recordedPathOf',
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
