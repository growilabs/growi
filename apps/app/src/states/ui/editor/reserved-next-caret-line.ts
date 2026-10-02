import { useEffect } from 'react';
import { globalEventTarget } from '@growi/core/dist/utils';
import { atom, useAtomValue, useSetAtom } from 'jotai';

export type ReservedNextCaretLineEventDetail = {
  lineNumber: number;
};

/**
 * Atom for managing the reserved next caret line number
 */
const reservedNextCaretLineAtom = atom<number>(0);

/**
 * Hook to get and manage the reserved next caret line number
 * This hook listens to the 'reservedNextCaretLine' event from globalEventTarget
 * @returns The current reserved next caret line number
 */
export const useReservedNextCaretLine = (): void => {
  const setReservedNextCaretLine = useSetAtom(reservedNextCaretLineAtom);

  useEffect(() => {
    const handler = (evt: CustomEvent<ReservedNextCaretLineEventDetail>) => {
      setReservedNextCaretLine(evt.detail.lineNumber);
    };

    globalEventTarget.addEventListener('reservedNextCaretLine', handler);

    return function cleanup() {
      globalEventTarget.removeEventListener('reservedNextCaretLine', handler);
    };
  }, [setReservedNextCaretLine]);
};

export const useReservedNextCaretLineValue = (): number =>
  useAtomValue(reservedNextCaretLineAtom);

/**
 * Hook to set the reserved next caret line number
 * @returns Setter function for the reserved next caret line number
 */
export const useSetReservedNextCaretLine = () => {
  return useSetAtom(reservedNextCaretLineAtom);
};
