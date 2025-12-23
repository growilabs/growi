import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';
import { usePageAccessoriesModalStatus } from '~/states/ui/modal/page-accessories';

import { useAutoOpenModalByQueryParam } from './hooks';

type PageAccessoriesModalProps = Record<string, unknown>;

export const PageAccessoriesModalLazyLoaded = (): JSX.Element => {
  const status = usePageAccessoriesModalStatus();

  useAutoOpenModalByQueryParam();

  const PageAccessoriesModal = useLazyLoader<PageAccessoriesModalProps>(
    'page-accessories-modal',
    () => import('./PageAccessoriesModal').then(mod => ({ default: mod.PageAccessoriesModal })),
    status?.isOpened ?? false,
  );

  // PageAccessoriesModal handles early return and fadeout transition internally
  return PageAccessoriesModal ? <PageAccessoriesModal /> : <></>;
};
