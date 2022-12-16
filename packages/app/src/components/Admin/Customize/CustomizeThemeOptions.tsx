import React, { useMemo } from 'react';

import { GrowiThemeMetadata, GrowiThemeSchemeType } from '@growi/core';
import { useTranslation } from 'next-i18next';

import { ThemeColorBox } from './ThemeColorBox';


type Props = {
  availableThemes: GrowiThemeMetadata[],
  selectedTheme?: string,
  onSelected?: (themeName: string) => void,
};

const CustomizeThemeOptions = (props: Props): JSX.Element => {
  const { t } = useTranslation('admin');

  const { availableThemes, selectedTheme, onSelected } = props;

  const lightNDarkThemes = useMemo(() => {
    return availableThemes.filter(s => s.schemeType === GrowiThemeSchemeType.BOTH);
  }, [availableThemes]);
  const oneModeThemes = useMemo(() => {
    return availableThemes.filter(s => s.schemeType !== GrowiThemeSchemeType.BOTH);
  }, [availableThemes]);

  return (
    <div id="themeOptions">
      {/* Light and Dark Themes */}
      <div>
        <h3>{t('customize_settings.theme_desc.light_and_dark')}</h3>
        <div className="d-flex flex-wrap">
          {lightNDarkThemes.map((theme) => {
            return (
              <ThemeColorBox
                key={theme.name}
                isSelected={selectedTheme != null && selectedTheme === theme.name}
                metadata={theme}
                onSelected={() => onSelected?.(theme.name)}
              />
            );
          })}
        </div>
      </div>
      {/* Only one mode Theme */}
      <div className="mt-3">
        <h3>{t('customize_settings.theme_desc.unique')}</h3>
        <div className="d-flex flex-wrap">
          {oneModeThemes.map((theme) => {
            return (
              <ThemeColorBox
                key={theme.name}
                isSelected={selectedTheme != null && selectedTheme === theme.name}
                metadata={theme}
                onSelected={() => onSelected?.(theme.name)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );

};


export default CustomizeThemeOptions;
