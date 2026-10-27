import type { BasedOn, ChangeProposalDocument } from '../../interfaces';

export type BasedOnRejection =
  | { readonly code: 'based-on-unavailable' }
  | {
      readonly code: 'based-on-operation-not-eligible';
      readonly operationKey?: string;
    };

export const validateBasedOn = (
  _basedOn: BasedOn,
  _base: Pick<
    ChangeProposalDocument,
    'requester' | 'entry' | 'operations'
  > | null,
  _requesterId: string,
):
  | { readonly ok: true; readonly basedOn: BasedOn }
  | { readonly ok: false; readonly rejection: BasedOnRejection } => {
  throw new Error('Not implemented');
};
