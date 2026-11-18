import { useMemo } from 'react';
import { GrowiThemeSchemeType } from '@growi/core';
import { PresetThemesMetadatas } from '@growi/preset-themes';
import type { Diff2HtmlConfig } from 'diff2html';
import { ColorSchemeType } from 'diff2html/lib/types';

import { useSWRxGrowiThemeSetting } from '~/stores/admin/customize';
import { Themes, useNextThemes } from '~/stores-universal/use-next-themes';

export const buildDiff2HtmlOptions = (
  colorScheme: ColorSchemeType,
): Diff2HtmlConfig => ({
  outputFormat: 'side-by-side',
  drawFileList: false,
  colorScheme,
});

// GROWI theme first; only when it supports both schemes does the user's light/dark setting decide.
export const useDiff2HtmlColorScheme = (): ColorSchemeType => {
  const { theme: userTheme } = useNextThemes();
  const { data: growiTheme } = useSWRxGrowiThemeSetting();

  return useMemo(() => {
    if (growiTheme == null) {
      return ColorSchemeType.AUTO;
    }

    const growiThemeSchemeType =
      growiTheme.pluginThemesMetadatas[0]?.schemeType ??
      PresetThemesMetadatas.find(
        (theme) => theme.name === growiTheme.currentTheme,
      )?.schemeType;

    switch (growiThemeSchemeType) {
      case GrowiThemeSchemeType.DARK:
        return ColorSchemeType.DARK;
      case GrowiThemeSchemeType.LIGHT:
        return ColorSchemeType.LIGHT;
      default:
      // GrowiThemeSchemeType.BOTH
    }
    switch (userTheme) {
      case Themes.DARK:
        return ColorSchemeType.DARK;
      case Themes.LIGHT:
        return ColorSchemeType.LIGHT;
      default:
        return ColorSchemeType.AUTO;
    }
  }, [growiTheme, userTheme]);
};
