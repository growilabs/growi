import { useCallback } from 'react';
import { useSWRStatic } from '@growi/core/dist/swr';
import type { SWRResponse } from 'swr';

type DrawioModalStatus = {
  isOpened: boolean;
  editorKey: string | undefined;
};

type DrawioModalStatusUtils = {
  open(editorKey: string): void;
  close(): void;
};

export const useDrawioModalForEditor = (
  status?: DrawioModalStatus,
): SWRResponse<DrawioModalStatus, Error> & DrawioModalStatusUtils => {
  const initialData: DrawioModalStatus = {
    isOpened: false,
    editorKey: undefined,
  };
  const swrResponse = useSWRStatic<DrawioModalStatus, Error>(
    'drawioModalStatusForEditor',
    status,
    { fallbackData: initialData },
  );

  const { mutate } = swrResponse;

  const open = useCallback(
    (editorKey: string | undefined): void => {
      mutate({ isOpened: true, editorKey });
    },
    [mutate],
  );

  const close = useCallback((): void => {
    mutate({ isOpened: false, editorKey: undefined });
  }, [mutate]);

  return {
    ...swrResponse,
    open,
    close,
  };
};
