// @vitest-environment happy-dom

import { GrowiThemeSchemeType } from '@growi/core';
import { renderHook } from '@testing-library/react';
import { createPatch } from 'diff';
import { html } from 'diff2html';
import { ColorSchemeType } from 'diff2html/lib/types';

import { Themes, useNextThemes } from '~/stores-universal/use-next-themes';

import {
  buildDiff2HtmlOptions,
  useDiff2HtmlColorScheme,
} from './diff2html-options';

vi.mock('~/stores-universal/use-next-themes', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('~/stores-universal/use-next-themes')
  >()),
  useNextThemes: vi.fn(),
}));

const mockGrowiTheme = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('~/stores/admin/customize', () => ({
  useSWRxGrowiThemeSetting: () => ({ data: mockGrowiTheme.current }),
}));

const patch = createPatch(
  'page-id',
  'line one\nline two\n',
  'line one\nline 2\nline three\n',
);

describe('buildDiff2HtmlOptions', () => {
  it.each(
    Object.values(ColorSchemeType),
  )('renders the same HTML as the options RevisionDiff built inline (%s)', (colorScheme) => {
    const legacyOptions = {
      outputFormat: 'side-by-side',
      drawFileList: false,
      colorScheme,
    } as const;

    expect(html(patch, buildDiff2HtmlOptions(colorScheme))).toBe(
      html(patch, legacyOptions),
    );
  });
});

describe('useDiff2HtmlColorScheme', () => {
  const setUserTheme = (theme: Themes | undefined) => {
    vi.mocked(useNextThemes).mockReturnValue({
      theme,
    } as ReturnType<typeof useNextThemes>);
  };

  const setGrowiTheme = (
    schemeType: GrowiThemeSchemeType | undefined,
    withPlugin = false,
  ) => {
    mockGrowiTheme.current = {
      currentTheme: 'default',
      pluginThemesMetadatas: withPlugin ? [{ schemeType }] : [],
    };
  };

  beforeEach(() => {
    mockGrowiTheme.current = undefined;
    setUserTheme(undefined);
  });

  it('is AUTO while the GROWI theme setting is not loaded', () => {
    setUserTheme(Themes.DARK);
    const { result } = renderHook(() => useDiff2HtmlColorScheme());
    expect(result.current).toBe(ColorSchemeType.AUTO);
  });

  it('follows a dark plugin theme regardless of the user setting', () => {
    setGrowiTheme(GrowiThemeSchemeType.DARK, true);
    setUserTheme(Themes.LIGHT);
    const { result } = renderHook(() => useDiff2HtmlColorScheme());
    expect(result.current).toBe(ColorSchemeType.DARK);
  });

  it('follows a light plugin theme regardless of the user setting', () => {
    setGrowiTheme(GrowiThemeSchemeType.LIGHT, true);
    setUserTheme(Themes.DARK);
    const { result } = renderHook(() => useDiff2HtmlColorScheme());
    expect(result.current).toBe(ColorSchemeType.LIGHT);
  });

  it('uses the user light/dark setting when the theme supports both', () => {
    setGrowiTheme(GrowiThemeSchemeType.BOTH, true);
    setUserTheme(Themes.DARK);
    const { result } = renderHook(() => useDiff2HtmlColorScheme());
    expect(result.current).toBe(ColorSchemeType.DARK);
  });

  it('is AUTO when the theme supports both and the user setting is system', () => {
    setGrowiTheme(GrowiThemeSchemeType.BOTH, true);
    setUserTheme(Themes.SYSTEM);
    const { result } = renderHook(() => useDiff2HtmlColorScheme());
    expect(result.current).toBe(ColorSchemeType.AUTO);
  });
});
