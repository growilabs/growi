import { useEffect } from 'react';

import { useCurrentPagePath } from '~/states/page';
import { usePageCreateModalActions } from '~/states/ui/modal/page-create';

type Props = {
  onDeleteRender: () => void;
};

const CreatePage = ({ onDeleteRender }: Props): null => {
  const { open: openCreateModal } = usePageCreateModalActions();
  const currentPath = useCurrentPagePath();

  useEffect(() => {
    openCreateModal(currentPath ?? '');
    onDeleteRender();
  }, [currentPath, openCreateModal, onDeleteRender]);

  return null;
};

export { CreatePage };
