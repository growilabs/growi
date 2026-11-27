import type { ComponentType } from 'react';

import type {
  ChangeProposalView,
  OperationView,
  ProposalEntry,
} from '../../../interfaces';

export type ProposalActionSlotProps = {
  readonly proposal: ChangeProposalView;
};

export type OperationActionSlotProps = {
  readonly proposal: ChangeProposalView;
  readonly operation: OperationView;
};

export type RequesterActionSlots = {
  readonly proposal?: () => Promise<ComponentType<ProposalActionSlotProps>>;
  readonly operation?: () => Promise<ComponentType<OperationActionSlotProps>>;
};

export const REQUESTER_ACTION_SLOTS: Readonly<
  Partial<Record<ProposalEntry, RequesterActionSlots>>
> = {};
