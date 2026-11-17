import type { BasedOn, ChangeProposalDocument } from '../../interfaces';
import { BASED_ON_ELIGIBLE_STATUSES } from '../../interfaces';

export type BasedOnRejection =
  | { readonly code: 'based-on-unavailable' }
  | {
      readonly code: 'based-on-operation-not-eligible';
      readonly operationKey?: string;
    };

export const validateBasedOn = (
  basedOn: BasedOn,
  base: Pick<
    ChangeProposalDocument,
    'requester' | 'entry' | 'operations'
  > | null,
  requesterId: string,
):
  | { readonly ok: true; readonly basedOn: BasedOn }
  | { readonly ok: false; readonly rejection: BasedOnRejection } => {
  // One shape for all three causes so a caller cannot probe other users' proposals.
  if (
    base == null ||
    base.requester !== requesterId ||
    base.entry === 'revert'
  ) {
    return { ok: false, rejection: { code: 'based-on-unavailable' } };
  }

  if (basedOn.operationKeys.length === 0) {
    return {
      ok: false,
      rejection: { code: 'based-on-operation-not-eligible' },
    };
  }

  const eligibleStatuses = BASED_ON_ELIGIBLE_STATUSES[basedOn.relation];
  const statusByKey = new Map(base.operations.map((o) => [o.key, o.status]));
  for (const key of basedOn.operationKeys) {
    const status = statusByKey.get(key);
    if (status == null || !eligibleStatuses.includes(status)) {
      return {
        ok: false,
        rejection: {
          code: 'based-on-operation-not-eligible',
          operationKey: key,
        },
      };
    }
  }

  return {
    ok: true,
    basedOn: { ...basedOn, operationKeys: [...new Set(basedOn.operationKeys)] },
  };
};
