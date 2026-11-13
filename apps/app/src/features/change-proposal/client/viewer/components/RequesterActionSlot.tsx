import { type JSX, useMemo } from 'react';
import dynamic from 'next/dynamic';

import type { ChangeProposalView, OperationView } from '../../../interfaces';
import {
  type OperationActionSlotProps,
  type ProposalActionSlotProps,
  REQUESTER_ACTION_SLOTS,
} from './requester-action-slots';

type RequesterActionSlotProps = {
  readonly proposal: ChangeProposalView;
  readonly operation?: OperationView;
};

export const RequesterActionSlot = ({
  proposal,
  operation,
}: RequesterActionSlotProps): JSX.Element | null => {
  const { entry, isRequester } = proposal;
  const row = isRequester ? REQUESTER_ACTION_SLOTS[entry] : undefined;
  const isOperationSlot = operation != null;
  const loader = isOperationSlot ? row?.operation : row?.proposal;

  const Slot = useMemo(
    () =>
      loader == null
        ? null
        : dynamic<ProposalActionSlotProps & Partial<OperationActionSlotProps>>(
            loader,
            { ssr: false },
          ),
    [loader],
  );

  if (Slot == null) {
    return null;
  }

  return <Slot proposal={proposal} operation={operation} />;
};
