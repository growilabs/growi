import { type JSX, useMemo } from 'react';
import dynamic from 'next/dynamic';

import type { ChangeProposalView } from '../../../interfaces';
import {
  REQUESTER_ONLY_SECTIONS,
  type RequesterOnlySectionProps,
} from './requester-only-sections';

type RequesterOnlySectionViewProps = { readonly view: ChangeProposalView };

export const RequesterOnlySection = ({
  view,
}: RequesterOnlySectionViewProps): JSX.Element | null => {
  const { entry, id, isRequester } = view;
  const loader = isRequester ? REQUESTER_ONLY_SECTIONS[entry] : undefined;

  const Section = useMemo(
    () =>
      loader == null
        ? null
        : dynamic<RequesterOnlySectionProps>(loader, { ssr: false }),
    [loader],
  );

  if (Section == null) {
    return null;
  }

  return <Section proposalId={id} />;
};
