import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

import type { IGrowiPluginHasId } from '../../../../interfaces';

export type PluginDeleteModalStatus = {
  isOpened: boolean;
  id: string;
  name: string;
  url: string;
};

export type PluginDeleteModalActions = {
  open: (plugin: IGrowiPluginHasId) => void;
  close: () => void;
};

// Atom definition
const pluginDeleteModalAtom = atom<PluginDeleteModalStatus>({
  isOpened: false,
  id: '',
  name: '',
  url: '',
});

// Read-only hook (useAtomValue)
export const usePluginDeleteModalStatus = (): PluginDeleteModalStatus => {
  return useAtomValue(pluginDeleteModalAtom);
};

// Actions hook (useSetAtom + useCallback)
export const usePluginDeleteModalActions = (): PluginDeleteModalActions => {
  const setStatus = useSetAtom(pluginDeleteModalAtom);

  const open = useCallback(
    (plugin: IGrowiPluginHasId) => {
      setStatus({
        isOpened: true,
        id: plugin._id,
        name: plugin.meta.name,
        url: plugin.origin.url,
      });
    },
    [setStatus],
  );

  const close = useCallback(() => {
    setStatus({
      isOpened: false,
      id: '',
      name: '',
      url: '',
    });
  }, [setStatus]);

  return { open, close };
};
