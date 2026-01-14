import { useCallback } from 'react';
import type { Extension } from '@codemirror/state';
import { Compartment, StateEffect } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

type CleanupFunctions = () => void;
export type AppendExtensions = (
  extensions: Extension | Extension[],
) => CleanupFunctions | undefined;

export const useAppendExtensions = (view?: EditorView): AppendExtensions => {
  return useCallback(
    (args) => {
      const extensions = Array.isArray(args) ? args : [args];

      const compartments = extensions.map(() => new Compartment());
      view?.dispatch({
        effects: extensions.map((extension, index) => {
          return StateEffect.appendConfig.of(compartments[index].of(extension));
        }),
      });

      // return cleanup function
      return () => {
        view?.dispatch({
          effects: compartments.map((compartment) =>
            compartment.reconfigure([]),
          ),
        });
      };
    },
    [view],
  );
};
