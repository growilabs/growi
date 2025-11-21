import type { JSX } from 'react';

import { useLazyLoader } from '../../../components/utils/use-lazy-loader';

type CreateTemplateModalProps = {
  path: string;
  isOpen: boolean;
  onClose: () => void;
};

export const CreateTemplateModalLazyLoaded = (props: CreateTemplateModalProps): JSX.Element => {
  const CreateTemplateModal = useLazyLoader<CreateTemplateModalProps>(
    'create-template-modal',
    () => import('./CreateTemplateModal').then(mod => ({ default: mod.CreateTemplateModal })),
    props.isOpen,
  );

  return CreateTemplateModal != null ? <CreateTemplateModal {...props} /> : <></>;
};
