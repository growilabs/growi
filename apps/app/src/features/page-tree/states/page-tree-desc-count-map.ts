import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

// Type definitions
export type UpdateDescCountData = Map<string, number>;

export type PageTreeDescCountMapGetter = {
  getDescCount: (pageId?: string) => number | null;
};

export type PageTreeDescCountMapActions = {
  update: (newData: UpdateDescCountData) => void;
};

// Atom definition
const pageTreeDescCountMapAtom = atom<UpdateDescCountData>(new Map());

export const usePageTreeDescCountMap = (): PageTreeDescCountMapGetter => {
  const data = useAtomValue(pageTreeDescCountMapAtom);

  const getDescCount = useCallback(
    (pageId?: string) => {
      return pageId != null ? (data.get(pageId) ?? null) : null;
    },
    [data],
  );

  return { getDescCount };
};

// Actions hook (write-only with callbacks)
export const usePageTreeDescCountMapAction =
  (): PageTreeDescCountMapActions => {
    const setDescCountMap = useSetAtom(pageTreeDescCountMapAtom);

    const update = useCallback(
      (newData: UpdateDescCountData) => {
        setDescCountMap((current) => {
          return new Map([...current, ...newData]);
        });
      },
      [setDescCountMap],
    );

    return { update };
  };
