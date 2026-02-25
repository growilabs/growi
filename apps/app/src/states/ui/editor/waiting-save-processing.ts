import { atom, useAtomValue, useSetAtom } from 'jotai';

const waitingSaveProcessingAtom = atom<boolean>(false);

export const useWaitingSaveProcessing = () => {
  return useAtomValue(waitingSaveProcessingAtom);
};

export const useWaitingSaveProcessingActions = () => {
  const setState = useSetAtom(waitingSaveProcessingAtom);
  return {
    mutate: (value: boolean) => {
      setState(value);
    },
  };
};
