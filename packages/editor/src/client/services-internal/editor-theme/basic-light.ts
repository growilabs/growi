import { type Extension, Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicLight as basicLightTheme } from 'cm6-theme-basic-light';

// basicLight is a light theme but gives the completion tooltip a dark background,
// which makes the dark completion text unreadable.
// Editor themes are applied with Prec.high, so use Prec.highest to override it.
const completionTooltipOverride = Prec.highest(
  EditorView.theme({
    '.cm-tooltip-autocomplete': {
      backgroundColor: 'var(--bs-white)',
    },
  }),
);

export const basicLight: Extension = [
  basicLightTheme,
  completionTooltipOverride,
];
