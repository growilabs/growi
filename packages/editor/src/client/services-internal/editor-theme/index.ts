import { type Extension, Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import type { EditorTheme } from '../../../consts/index.js';

export const getEditorTheme = async (
  themeName?: EditorTheme,
): Promise<Extension> => {
  switch (themeName) {
    case 'eclipse':
      return (await import('./eclipse.js')).eclipse;
    case 'basic': {
      const { basicLight } = await import('cm6-theme-basic-light');
      // basicLight is a light theme but gives the completion tooltip a dark background,
      // which makes the dark completion text unreadable.
      // Editor themes are applied with Prec.high, so use Prec.highest to override it.
      const basicLightOverride = Prec.highest(
        EditorView.theme({
          '.cm-tooltip-autocomplete': {
            backgroundColor: 'var(--bs-white)',
          },
        }),
      );
      return [basicLight, basicLightOverride];
    }
    case 'ayu':
      return (await import('./ayu.js')).ayu;
    case 'rosepine':
      return (await import('./rose-pine.js')).rosePine;
    case 'defaultdark':
      return (await import('./original-dark.js')).originalDark;
    case 'material':
      return (await import('./material.js')).materialDark;
    case 'nord':
      return (await import('./nord.js')).nord;
    case 'cobalt':
      return (await import('./cobalt.js')).cobalt;
    case 'kimbie':
      return (await import('@uiw/codemirror-theme-kimbie')).kimbie;
  }
  return (await import('./original-light.js')).originalLight;
};
