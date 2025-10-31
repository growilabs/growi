import { useCallback } from 'react';
import { useSWRStatic } from '@growi/core/dist/swr';
import type { SWRResponse } from 'swr';

import type { EditorMode } from '../stores-universal/ui';

/*
 * PageStatusAlert
 */
type OpenPageStatusAlertOptions = {
  hideEditorMode?: EditorMode;
  onRefleshPage?: () => void;
  onResolveConflict?: () => void;
};

type PageStatusAlertStatus = {
  isOpen: boolean;
  hideEditorMode?: EditorMode;
  onRefleshPage?: () => void;
  onResolveConflict?: () => void;
};

type PageStatusAlertUtils = {
  open: (openPageStatusAlert: OpenPageStatusAlertOptions) => void;
  close: () => void;
};
export const usePageStatusAlert = (): SWRResponse<
  PageStatusAlertStatus,
  Error
> &
  PageStatusAlertUtils => {
  const initialData: PageStatusAlertStatus = { isOpen: false };
  const swrResponse = useSWRStatic<PageStatusAlertStatus, Error>(
    'pageStatusAlert',
    undefined,
    { fallbackData: initialData },
  );
  const { mutate } = swrResponse;

  const open = useCallback(
    ({ ...options }) => {
      mutate({ isOpen: true, ...options });
    },
    [mutate],
  );

  const close = useCallback(() => {
    mutate({ isOpen: false });
  }, [mutate]);

  return {
    ...swrResponse,
    open,
    close,
  };
};
