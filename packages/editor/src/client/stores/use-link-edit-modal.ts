import { useSWRStatic } from '@growi/core/dist/swr';
import type { SWRResponse } from 'swr';

import type { Linker } from '../../models';

type LinkEditModalStatus = {
  isOpened: boolean;
  defaultMarkdownLink?: Linker;
  onSave?: (linkText: string) => void;
};

type LinkEditModalUtils = {
  open(defaultMarkdownLink: Linker, onSave: (linkText: string) => void): void;
  close(): void;
};

export const useLinkEditModal = (): SWRResponse<LinkEditModalStatus, Error> &
  LinkEditModalUtils => {
  const initialStatus: LinkEditModalStatus = { isOpened: false };
  const swrResponse = useSWRStatic<LinkEditModalStatus, Error>(
    'linkEditModal',
    undefined,
    { fallbackData: initialStatus },
  );

  return Object.assign(swrResponse, {
    open: (defaultMarkdownLink: Linker, onSave: (linkText: string) => void) => {
      swrResponse.mutate({ isOpened: true, defaultMarkdownLink, onSave });
    },
    close: () => {
      swrResponse.mutate({ isOpened: false });
    },
  });
};
