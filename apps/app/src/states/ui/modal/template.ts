import { atom, useAtomValue, useSetAtom } from 'jotai';

type TemplateSelectedCallback = (templateText: string) => void;

type TemplateModalOptions = {
  onSubmit?: TemplateSelectedCallback;
};

export type TemplateModalState = TemplateModalOptions & {
  isOpened: boolean;
};

const templateModalAtom = atom<TemplateModalState>({
  isOpened: false,
  onSubmit: undefined,
});

export const useTemplateModalStatus = () => {
  return useAtomValue(templateModalAtom);
};

export const useTemplateModalActions = () => {
  const setModalState = useSetAtom(templateModalAtom);

  return {
    open: (opts: TemplateModalOptions) => {
      setModalState({ isOpened: true, onSubmit: opts.onSubmit });
    },
    close: () => {
      setModalState({ isOpened: false, onSubmit: undefined });
    },
  };
};
