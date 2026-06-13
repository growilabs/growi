import { useEffect } from 'react';

import { useCurrentPagePath } from '~/states/page/index.js';
import { usePageCreateModalActions } from '~/states/ui/modal/page-create.js';

import type { HotkeyBindingDef } from '../HotkeysManager.js';

type Props = {
  onDeleteRender: () => void;
};

export const hotkeyBindings: HotkeyBindingDef = {
  keys: 'c',
  category: 'single',
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
