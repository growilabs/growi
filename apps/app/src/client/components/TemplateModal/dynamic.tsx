import type { JSX } from 'react';

import { useTemplateModalStatus } from '@growi/editor';

import { useLazyLoader } from '~/client/util/use-lazy-loader';

type TemplateModalProps = Record<string, unknown>;

export const TemplateModalLazyLoaded = (): JSX.Element => {
  const status = useTemplateModalStatus();

  const TemplateModal = useLazyLoader<TemplateModalProps>(
    'template-modal',
    () => import('./TemplateModal').then(mod => ({ default: mod.TemplateModal })),
    status?.isOpened ?? false,
  );

  return TemplateModal ? <TemplateModal /> : <></>;
};
