import type {
  ApplyResult,
  ApplyTrigger,
  ChangeProposalDocument,
  ChangeProposalNotificationSnapshot,
  ChangeProposalSettingsUpdate,
  ChangeProposalSettingsView,
  ChangeProposalSummaryView,
  ChangeProposalView,
  OperationView,
  PerPageNotificationsView,
  ProposalLinkView,
  RequesterProposalState,
  RevertResult,
  RevisionMarkView,
} from '.';
import {
  APPLIED_AT_LEAST_ONCE_STATUSES,
  BASED_ON_ELIGIBLE_STATUSES,
  MAX_TOTAL_BODY_BYTES,
} from '.';

describe('change-proposal interfaces barrel', () => {
  it('declares the total body cap as 8 MiB', () => {
    expect(MAX_TOTAL_BODY_BYTES).toBe(8 * 1024 * 1024);
  });

  it('maps each relation to the operation statuses it may be based on', () => {
    expect(BASED_ON_ELIGIBLE_STATUSES).toEqual({
      'follow-up': ['stale', 'failed', 'skipped'],
      rework: ['applied', 'revert-refused'],
    });
  });

  it('lists the statuses that mean "applied at least once"', () => {
    expect(APPLIED_AT_LEAST_ONCE_STATUSES).toEqual([
      'applied',
      'reverted',
      'revert-refused',
    ]);
  });

  it('exports the shared type names sibling specs import', () => {
    expectTypeOf<ApplyTrigger['kind']>().toEqualTypeOf<
      'request' | 'background'
    >();
    expectTypeOf<ApplyResult['type']>().toEqualTypeOf<'done' | 'in-progress'>();
    expectTypeOf<RevertResult['operations'][number]['key']>().toBeString();
    expectTypeOf<ChangeProposalView['operations']>().toEqualTypeOf<
      readonly OperationView[]
    >();
    expectTypeOf<ChangeProposalSummaryView['pages']>().not.toBeNever();
    expectTypeOf<
      RequesterProposalState['perPageNotifications']
    >().toEqualTypeOf<PerPageNotificationsView>();
    expectTypeOf<ProposalLinkView['relation']>().toEqualTypeOf<
      'follow-up' | 'rework'
    >();
    expectTypeOf<RevisionMarkView['isRevert']>().toBeBoolean();
    expectTypeOf<
      ChangeProposalDocument['perPageNotifications']
    >().toBeBoolean();
    expectTypeOf<ChangeProposalNotificationSnapshot['kind']>().toEqualTypeOf<
      'apply' | 'revert'
    >();
    expectTypeOf<ChangeProposalSettingsView>().not.toBeNever();
    expectTypeOf<ChangeProposalSettingsUpdate>().not.toBeNever();
  });
});
