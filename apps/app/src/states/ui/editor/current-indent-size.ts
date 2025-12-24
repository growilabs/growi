import { atom, useAtomValue, useSetAtom } from 'jotai';

import { defaultIndentSizeAtom } from '~/states/server-configurations';

// Current indent size state - can be undefined to use default
const currentIndentSizeAtom = atom<number | undefined>(undefined);

// Derived atom that provides fallback to default
const currentIndentSizeWithFallbackAtom = atom((get) => {
  const currentSize = get(currentIndentSizeAtom);
  const defaultSize = get(defaultIndentSizeAtom);
  return currentSize ?? defaultSize;
});

export const useCurrentIndentSize = () => {
  return useAtomValue(currentIndentSizeWithFallbackAtom);
};

export const useCurrentIndentSizeActions = () => {
  const setState = useSetAtom(currentIndentSizeAtom);
  return {
    mutate: (value: number | undefined) => {
      setState(value);
    },
  };
};
