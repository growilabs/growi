import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';
import { useStaticSWR } from '~/stores/use-static-swr';

import type { IGrowiPluginHasId } from '../../interfaces';

type Plugins = {
  plugins: IGrowiPluginHasId[];
};

export const useSWRxAdminPlugins = (): SWRResponse<Plugins, Error> => {
  return useSWR('/plugins', async (endpoint) => {
    try {
      const res = await apiv3Get<Plugins>(endpoint);
      return res.data;
    } catch (err) {
      throw new Error(err);
    }
  });
};

/*
 * PluginDeleteModal
 */
type PluginDeleteModalStatus = {
  isOpen: boolean;
  id: string;
  name: string;
  url: string;
};

type PluginDeleteModalUtils = {
  open(plugin: IGrowiPluginHasId): Promise<void>;
  close(): Promise<void>;
};

export const usePluginDeleteModal = (): SWRResponse<
  PluginDeleteModalStatus,
  Error
> &
  PluginDeleteModalUtils => {
  const initialStatus: PluginDeleteModalStatus = {
    isOpen: false,
    id: '',
    name: '',
    url: '',
  };

  const swrResponse = useStaticSWR<PluginDeleteModalStatus, Error>(
    'pluginDeleteModal',
    undefined,
    { fallbackData: initialStatus },
  );
  const { mutate } = swrResponse;

  const open = async (plugin) => {
    mutate({
      isOpen: true,
      id: plugin._id,
      name: plugin.meta.name,
      url: plugin.origin.url,
    });
  };

  const close = async () => {
    mutate(initialStatus);
  };

  return {
    ...swrResponse,
    open,
    close,
  };
};
