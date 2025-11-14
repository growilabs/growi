import { ColorScheme } from '@growi/core';
import { isClient } from '@growi/core/dist/utils';
import { ThemeProvider, useTheme } from 'next-themes';
import type { ThemeProviderProps, UseThemeProps } from 'next-themes/dist/types';

import { useForcedColorScheme } from '~/states/global';

export const Themes = {
  ...ColorScheme,
  SYSTEM: 'system',
} as const;
export type Themes = (typeof Themes)[keyof typeof Themes];

const ATTRIBUTE = 'data-bs-theme';

export const NextThemesProvider: React.FC<ThemeProviderProps> = (props) => {
  const forcedColorScheme = useForcedColorScheme();

  return (
    <ThemeProvider
      {...props}
      forcedTheme={forcedColorScheme}
      attribute={ATTRIBUTE}
    />
  );
};

type UseThemeExtendedProps = Omit<UseThemeProps, 'theme' | 'resolvedTheme'> & {
  theme: Themes;
  resolvedTheme: ColorScheme;
  useOsSettings: boolean;
  isDarkMode: boolean;
  isForcedByGrowiTheme: boolean;
  resolvedThemeByAttributes?: ColorScheme;
};

export const useNextThemes = (): UseThemeProps & UseThemeExtendedProps => {
  const props = useTheme();
  const forcedColorScheme = useForcedColorScheme();

  const resolvedTheme =
    forcedColorScheme ?? (props.resolvedTheme as ColorScheme);

  return Object.assign(props, {
    theme: props.theme as Themes,
    resolvedTheme,
    useOsSettings: props.theme === Themes.SYSTEM,
    isDarkMode: resolvedTheme === ColorScheme.DARK,
    isForcedByGrowiTheme: forcedColorScheme != null,
    resolvedThemeByAttributes: isClient()
      ? (document.documentElement.getAttribute(ATTRIBUTE) as ColorScheme)
      : undefined,
  });
};
