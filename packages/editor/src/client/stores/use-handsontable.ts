import { useCallback } from 'react';
import type { EditorView } from '@codemirror/view';
import { useSWRStatic } from '@growi/core/dist/swr';
import type { SWRResponse } from 'swr';

type HandsontableModalStatus = {
  isOpened: boolean;
  editor?: EditorView;
};

type HandsontableModalStatusUtils = {
  open(editor?: EditorView): void;
  close(): void;
};

export const useHandsontableModalForEditor = (
  status?: HandsontableModalStatus,
): SWRResponse<HandsontableModalStatus, Error> &
  HandsontableModalStatusUtils => {
  const initialData: HandsontableModalStatus = {
    isOpened: false,
    editor: undefined,
  };

  const swrResponse = useSWRStatic<HandsontableModalStatus, Error>(
    'handsontableModalStatus',
    status,
    { fallbackData: initialData },
  );

  const { mutate } = swrResponse;

  const open = useCallback(
    (editor?: EditorView): void => {
      mutate({
        isOpened: true,
        editor,
      });
    },
    [mutate],
  );
  const close = useCallback((): void => {
    mutate({
      isOpened: false,
      editor: undefined,
    });
  }, [mutate]);

  return {
    ...swrResponse,
    open,
    close,
  };
};
