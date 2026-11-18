import type { SupportedAction } from '~/interfaces/activity';

import type { ReviewChannel } from '../../interfaces';
import type { RecordProposalActivityArgs } from './proposal-activity';

type ArgsFor<A> = Extract<RecordProposalActivityArgs, { action: A }>;

describe('RecordProposalActivityArgs', () => {
  it('requires the channel on every review action (Req 20.8, 20.10)', () => {
    expectTypeOf<
      ArgsFor<
        | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_APPROVE
        | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_REJECT
        | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_ABSTAIN
        | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_ADD
        | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_REMOVE
      >['channel']
    >().toEqualTypeOf<ReviewChannel>();
  });

  it('takes no channel on create, apply and revert', () => {
    expectTypeOf<
      ArgsFor<
        | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_CREATE
        | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY
        | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT
      >['channel']
    >().toEqualTypeOf<undefined>();
  });
});
