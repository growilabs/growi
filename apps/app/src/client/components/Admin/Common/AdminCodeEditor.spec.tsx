import { render } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import { useNextThemes } from '~/stores-universal/use-next-themes';

import { AdminCodeEditor, type CodeEditorLanguage } from './AdminCodeEditor';

vi.mock('~/stores-universal/use-next-themes');

const mockedUseNextThemes = vi.mocked(useNextThemes);

const setDarkMode = (isDarkMode: boolean) => {
  // Only isDarkMode is consumed by AdminCodeEditor; auto-stub the rest.
  mockedUseNextThemes.mockReturnValue(
    mock<ReturnType<typeof useNextThemes>>({ isDarkMode }),
  );
};

describe('AdminCodeEditor', () => {
  beforeEach(() => {
    setDarkMode(false);
  });

  describe('rendering per language', () => {
    it.each<{ language: CodeEditorLanguage; code: string }>([
      { language: 'javascript', code: 'const x = 42;' },
      { language: 'css', code: '.a { color: red; }' },
      { language: 'html', code: '<div class="x">hi</div>' },
    ])('applies $language syntax highlighting to the value', ({
      language,
      code,
    }) => {
      const { container } = render(
        <AdminCodeEditor language={language} value={code} onChange={vi.fn()} />,
      );

      const content = container.querySelector('.cm-content');
      // The document text is rendered.
      expect(content?.textContent).toContain(code);
      // Highlighting is actually applied: the language extension wraps tokens in
      // <span> elements. A plain textarea, or an editor without a language
      // extension, renders the text with no token spans — this is exactly the
      // regression this feature fixes.
      expect(content?.querySelectorAll('span').length ?? 0).toBeGreaterThan(0);
    });

    it('renders an empty editor without error when value is empty', () => {
      const onChange = vi.fn();
      expect(() =>
        render(
          <AdminCodeEditor
            language="javascript"
            value=""
            onChange={onChange}
          />,
        ),
      ).not.toThrow();

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('theme following', () => {
    it('applies the light theme when not in dark mode', () => {
      setDarkMode(false);
      const { container } = render(
        <AdminCodeEditor language="css" value="" onChange={vi.fn()} />,
      );

      expect(container.querySelector('.cm-theme-light')).not.toBeNull();
      expect(container.querySelector('.cm-theme-dark')).toBeNull();
    });

    it('applies the dark theme when in dark mode', () => {
      setDarkMode(true);
      const { container } = render(
        <AdminCodeEditor language="css" value="" onChange={vi.fn()} />,
      );

      expect(container.querySelector('.cm-theme-dark')).not.toBeNull();
      expect(container.querySelector('.cm-theme-light')).toBeNull();
    });
  });

  describe('editing aids', () => {
    it('renders the line-number gutter', () => {
      const { container } = render(
        <AdminCodeEditor
          language="javascript"
          value={'line1\nline2'}
          onChange={vi.fn()}
        />,
      );

      expect(container.querySelector('.cm-lineNumbers')).not.toBeNull();
    });
  });

  describe('controlled value', () => {
    it('reflects an external value update (e.g. react-hook-form reset) into the editor', () => {
      const { container, rerender } = render(
        <AdminCodeEditor language="css" value="a{}" onChange={vi.fn()} />,
      );
      expect(container.querySelector('.cm-content')?.textContent).toContain(
        'a{}',
      );

      // External value change (parent re-render) must be reflected in the editor.
      rerender(
        <AdminCodeEditor
          language="css"
          value="b{color:red}"
          onChange={vi.fn()}
        />,
      );
      const content = container.querySelector('.cm-content');
      expect(content?.textContent).toContain('b{color:red}');
      expect(content?.textContent).not.toContain('a{}');
    });
  });
});
