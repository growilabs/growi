import type { JSX } from 'react';

import { useLinkEditModalStatus } from '@growi/editor/dist/states/modal/link-edit';

import { useLazyLoader } from '~/client/util/use-lazy-loader';

type LinkEditModalProps = Record<string, unknown>;

export const LinkEditModalLazyLoaded = (): JSX.Element => {
  const status = useLinkEditModalStatus();

  const LinkEditModal = useLazyLoader<LinkEditModalProps>(
    'link-edit-modal',
    () => import('./LinkEditModal').then(mod => ({ default: mod.LinkEditModal })),
    status?.isOpened ?? false,
  );

  return LinkEditModal ? <LinkEditModal /> : <></>;
};
