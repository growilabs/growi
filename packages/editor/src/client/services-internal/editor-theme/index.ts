import type { Extension } from '@codemirror/state';

import type { EditorTheme } from '../../../consts';

export const getEditorTheme = async (
  themeName?: EditorTheme,
): Promise<Extension> => {
  switch (themeName) {
    case 'eclipse':
      return (await import('./eclipse')).eclipse;
    case 'basic':
      return (await import('cm6-theme-basic-light')).basicLight;
    case 'ayu':
      return (await import('./ayu')).ayu;
    case 'rosepine':
      return (await import('./rose-pine')).rosePine;
    case 'defaultdark':
      return (await import('./original-dark')).originalDark;
    case 'material':
      return (await import('./material')).materialDark;
    case 'nord':
      return (await import('./nord')).nord;
    case 'cobalt':
      return (await import('./cobalt')).cobalt;
    case 'kimbie':
      return (await import('@uiw/codemirror-theme-kimbie')).kimbie;
  }
  return (await import('./original-light')).originalLight;
};
