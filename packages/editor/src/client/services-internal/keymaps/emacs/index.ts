import { Prec } from '@codemirror/state';

import type { KeymapFactory } from '../types';
import { registerFormattingBindings } from './formatting';
import { registerNavigationBindings } from './navigation';
import { registerStructuralBindings } from './structural';

export const emacsKeymap: KeymapFactory = async (onSave) => {
  const { EmacsHandler, emacs } = await import('@replit/codemirror-emacs');

  registerFormattingBindings(EmacsHandler);
  registerStructuralBindings(EmacsHandler);
  registerNavigationBindings(EmacsHandler);

  // C-x C-s → Save
  if (onSave != null) {
    EmacsHandler.addCommands({
      save() {
        onSave();
      },
    });
    EmacsHandler.bindKey('C-x C-s', 'save');
  }

  return {
    extension: emacs(),
    precedence: Prec.high,
    overrides: ['formatting', 'structural'],
  };
};
