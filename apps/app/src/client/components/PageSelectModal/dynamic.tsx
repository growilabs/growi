import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader.js';
import { usePageSelectModalStatus } from '~/states/ui/modal/page-select.js';

type PageSelectModalProps = Record<string, unknown>;

export const PageSelectModalLazyLoaded = (): JSX.Element => {
  const status = usePageSelectModalStatus();

  const PageSelectModal = useLazyLoader<PageSelectModalProps>(
    'page-select-modal',
    () =>
      import('./PageSelectModal.js').then((mod) => ({
        default: mod.PageSelectModal,
      })),
    status?.isOpened ?? false,
  );

  return PageSelectModal ? <PageSelectModal /> : <></>;
};
