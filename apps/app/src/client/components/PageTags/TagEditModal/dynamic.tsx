import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';
import { useTagEditModalStatus } from '~/states/ui/modal/tag-edit';

type TagEditModalProps = Record<string, unknown>;

export const TagEditModalLazyLoaded = (): JSX.Element => {
  const status = useTagEditModalStatus();

  const TagEditModal = useLazyLoader<TagEditModalProps>(
    'tag-edit-modal',
    () => import('./TagEditModal').then(mod => ({ default: mod.TagEditModal })),
    status?.isOpen ?? false,
  );

  return TagEditModal ? <TagEditModal /> : <></>;
};
