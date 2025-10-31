import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';
import { usePresentationModalStatus } from '~/states/ui/modal/page-presentation';

type PagePresentationModalProps = Record<string, unknown>;

export const PagePresentationModalLazyLoaded = (): JSX.Element => {
  const status = usePresentationModalStatus();

  const PagePresentationModal = useLazyLoader<PagePresentationModalProps>(
    'page-presentation-modal',
    () => import('./PagePresentationModal').then(mod => ({ default: mod.PagePresentationModal })),
    status?.isOpened ?? false,
  );

  return PagePresentationModal ? <PagePresentationModal /> : <></>;
};
