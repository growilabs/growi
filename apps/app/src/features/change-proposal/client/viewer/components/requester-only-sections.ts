import type { ComponentType } from 'react';

import type { ProposalEntry } from '../../../interfaces';

export type RequesterOnlySectionProps = { readonly proposalId: string };

export type RequesterOnlySectionLoader = () => Promise<
  ComponentType<RequesterOnlySectionProps>
>;

export type RequesterOnlySections = Readonly<
  Partial<Record<ProposalEntry, RequesterOnlySectionLoader>>
>;

export const REQUESTER_ONLY_SECTIONS: RequesterOnlySections = {};
