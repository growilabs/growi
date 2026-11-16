import * as domain from '.';

describe('change-proposal domain barrel', () => {
  it('exports the functions of the judgement files', () => {
    expect(Object.keys(domain).sort()).toEqual(
      [
        'activeReviewers',
        'buildProposalLinks',
        'buildRevertOperations',
        'canApprove',
        'computeAchievement',
        'dedupeReviewerInputs',
        'deriveProposalStatus',
        'deriveViewerRole',
        'deriveVisibleStage',
        'expandApprovalTargets',
        'hasForeignReviewer',
        'isMovableSourcePath',
        'isOwnPageForAutoApply',
        'isReviewer',
        'judgeRevertability',
        'planApplyOrder',
        'resolveAncestors',
        'reviewScopeOf',
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
