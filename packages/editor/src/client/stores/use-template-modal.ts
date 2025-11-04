import { useSWRStatic } from '@growi/core/dist/swr';
import type { SWRResponse } from 'swr';

type TemplateSelectedCallback = (templateText: string) => void;
type TemplateModalOptions = {
  onSubmit?: TemplateSelectedCallback;
};
export type TemplateModalStatus = TemplateModalOptions & {
  isOpened: boolean;
};

type TemplateModalUtils = {
  open(opts: TemplateModalOptions): void;
  close(): void;
};

export const useTemplateModal = (): SWRResponse<TemplateModalStatus, Error> &
  TemplateModalUtils => {
  const initialStatus: TemplateModalStatus = { isOpened: false };
  const swrResponse = useSWRStatic<TemplateModalStatus, Error>(
    'templateModal',
    undefined,
    { fallbackData: initialStatus },
  );

  return Object.assign(swrResponse, {
    open: (opts: TemplateModalOptions) => {
      swrResponse.mutate({ isOpened: true, onSubmit: opts.onSubmit });
    },
    close: () => {
      swrResponse.mutate({ isOpened: false });
    },
  });
};
