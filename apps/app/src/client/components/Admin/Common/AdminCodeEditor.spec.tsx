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
    // `distinctiveToken` is a token that ONLY the correct language's parser wraps
    // in a highlight <span>: the JS number literal `42`, the CSS value keyword
    // `red`, the HTML comment. Asserting on it (rather than merely "some span
    // exists") catches a mis-wired LANGUAGE_EXTENSIONS entry — e.g. css -> js() —
    // which the earlier span-count check would have silently passed.
    it.each<{
      language: CodeEditorLanguage;
      code: string;
      distinctiveToken: string;
    }>([
      { language: 'javascript', code: 'const x = 42;', distinctiveToken: '42' },
      { language: 'css', code: 'a { color: red; }', distinctiveToken: 'red' },
      {
        language: 'html',
        code: '<!-- note -->',
        distinctiveToken: '<!-- note -->',
      },
    ])('applies $language syntax highlighting to the value', ({
      language,
      code,
      distinctiveToken,
    }) => {
      const { container } = render(
        <AdminCodeEditor language={language} value={code} onChange={vi.fn()} />,
      );

      const content = container.querySelector('.cm-content');
      // The document text is rendered.
      expect(content?.textContent).toContain(code);
      // The correct language extension is wired: it wraps its own characteristic
      // token in a highlight <span>. A plain textarea, an editor without a
      // language extension, or one wired to the wrong language would not produce
      // this token — this is exactly the regression this feature fixes.
      const tokenTexts = Array.from(
        content?.querySelectorAll('span') ?? [],
      ).map((span) => span.textContent);
      expect(tokenTexts).toContain(distinctiveToken);
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

  describe('accessible label', () => {
    it('puts aria-label on the focusable content region, not the outer wrapper', () => {
      const { container } = render(
        <AdminCodeEditor
          language="javascript"
          value=""
          onChange={vi.fn()}
          aria-label="Custom Script"
        />,
      );

      // The label must be announced on `.cm-content` (the contenteditable a
      // screen reader focuses), not on the non-interactive outer wrapper.
      expect(
        container.querySelector('.cm-content')?.getAttribute('aria-label'),
      ).toBe('Custom Script');
      expect(
        container.firstElementChild?.getAttribute('aria-label'),
      ).toBeNull();
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
