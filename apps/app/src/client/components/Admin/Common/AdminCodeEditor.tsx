import { type JSX, useMemo } from 'react';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import type { Extension } from '@codemirror/state';
import ReactCodeMirror from '@uiw/react-codemirror';

import { useNextThemes } from '~/stores-universal/use-next-themes';

export type CodeEditorLanguage = 'javascript' | 'css' | 'html';

/**
 * Language -> CodeMirror language extension factory.
 * Data-driven so consumers never branch on language names; adding a language
 * is a single-entry change here.
 */
const LANGUAGE_EXTENSIONS: Record<CodeEditorLanguage, () => Extension> = {
  javascript: () => javascript(),
  css: () => css(),
  html: () => html(),
};

/**
 * Enable line numbers, bracket matching and auto-closing brackets (basicSetup
 * defaults), but disable autocompletion which is out of scope for admin custom
 * code editing.
 */
const BASIC_SETUP = { autocompletion: false } as const;

export interface AdminCodeEditorProps {
  /** Current code string (controlled value). */
  value: string;
  /** Notified with the next string on every user edit. */
  onChange: (value: string) => void;
  /** Language to highlight. */
  language: CodeEditorLanguage;
  /** Fired on blur (for react-hook-form blur integration; optional). */
  onBlur?: () => void;
  /** Accessible label (optional). */
  'aria-label'?: string;
}

/**
 * Stateless, controlled code editor with language-aware syntax highlighting and
 * basic editing aids. Holds no form/save logic — it only fulfills the
 * value/onChange contract and follows the admin light/dark theme.
 */
export const AdminCodeEditor = (props: AdminCodeEditorProps): JSX.Element => {
  const { value, onChange, language, onBlur, 'aria-label': ariaLabel } = props;

  const { isDarkMode } = useNextThemes();

  // Memoize so the editor reconfigures only when the language actually changes,
  // not on every keystroke-driven re-render (a new array reference would make
  // @uiw/react-codemirror re-dispatch a reconfigure effect every render).
  const extensions = useMemo(
    () => [LANGUAGE_EXTENSIONS[language]()],
    [language],
  );

  return (
    <div className="form-control p-0 mb-2 overflow-hidden">
      <ReactCodeMirror
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        theme={isDarkMode ? 'dark' : 'light'}
        extensions={extensions}
        basicSetup={BASIC_SETUP}
        minHeight="200px"
        maxHeight="400px"
        aria-label={ariaLabel}
      />
    </div>
  );
};
