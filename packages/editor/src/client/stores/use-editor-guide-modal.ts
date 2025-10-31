import { useSWRStatic } from '@growi/core/dist/swr';
import type { SWRResponse } from 'swr';

export type EditorGuideModalStatus = {
  isOpened: boolean;
};

type EditorGuideModalUtils = {
  open(): void;
  close(): void;
};

export const useEditorGuideModal = (): SWRResponse<
  EditorGuideModalStatus,
  Error
> &
  EditorGuideModalUtils => {
  const initialStatus: EditorGuideModalStatus = { isOpened: false };
  const swrResponse = useSWRStatic<EditorGuideModalStatus, Error>(
    'editorGuideModal',
    undefined,
    { fallbackData: initialStatus },
  );

  return Object.assign(swrResponse, {
    open: () => {
      swrResponse.mutate({ isOpened: true });
    },
    close: () => {
      swrResponse.mutate({ isOpened: false });
    },
  });
};
