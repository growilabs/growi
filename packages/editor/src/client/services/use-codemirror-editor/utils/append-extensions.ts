import type { Extension } from '@codemirror/state';
import { Compartment, StateEffect } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { useCallback } from 'react';

type CleanupFunctions = () => void;
export type AppendExtensions = (
  extensions: Extension | Extension[],
) => CleanupFunctions | undefined;

export const useAppendExtensions = (view?: EditorView): AppendExtensions => {
  return useCallback(
    (args) => {
      const extensions = Array.isArray(args) ? args : [args];

      const compartment = new Compartment();
      view?.dispatch({
        effects: extensions.map((extension) => {
          return StateEffect.appendConfig.of(compartment.of(extension));
        }),
      });

      // return cleanup function
      return () => {
        view?.dispatch({
          effects: compartment.reconfigure([]),
        });
      };
    },
    [view],
  );
};
