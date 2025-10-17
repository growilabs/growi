import { useEffect } from 'react';
import type EventEmitter from 'node:events';
import { atom, useAtomValue, useSetAtom } from 'jotai';

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var globalEmitter: EventEmitter;
}

/**
 * Atom for managing the reserved next caret line number
 */
const reservedNextCaretLineAtom = atom<number>(0);

/**
 * Hook to get and manage the reserved next caret line number
 * This hook listens to the 'reservedNextCaretLine' event from globalEmitter
 * @returns The current reserved next caret line number
 */
export const useReservedNextCaretLine = (): void => {
  const setReservedNextCaretLine = useSetAtom(reservedNextCaretLineAtom);

  useEffect(() => {
    const handler = (lineNumber: number) => {
      setReservedNextCaretLine(lineNumber);
    };

    globalEmitter?.on('reservedNextCaretLine', handler);

    return function cleanup() {
      globalEmitter?.removeListener('reservedNextCaretLine', handler);
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
