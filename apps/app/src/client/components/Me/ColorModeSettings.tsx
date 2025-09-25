import React, { useCallback, type JSX } from 'react';

import { useTranslation } from 'react-i18next';

import { Themes, useNextThemes } from '~/stores-universal/use-next-themes';


type ColorModeSettingsButtonProps = {
  isActive: boolean,
  children?: React.ReactNode,
  onClick?: () => void,
}

const ColorModeSettingsButton = ({ isActive, children, onClick }: ColorModeSettingsButtonProps): JSX.Element => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`btn py-2 px-4 fw-bold border-3 ${isActive ? 'btn-outline-primary' : 'btn-outline-neutral-secondary'}`}
    >
      { children }
    </button>
  );
};


export const ColorModeSettings = (): JSX.Element => {
  const { t } = useTranslation();

  const { setTheme, theme } = useNextThemes();

  const isActive = useCallback((targetTheme: Themes) => {
    return targetTheme === theme;
  }, [theme]);

  return (
    <div>
      <h2 className="border-bottom pb-2 mb-4 fs-4">{t('color_mode_settings.settings')}</h2>

      <div className="offset-md-3">

        <div className="d-flex column-gap-3">

          <ColorModeSettingsButton isActive={isActive(Themes.LIGHT)} onClick={() => { setTheme(Themes.LIGHT) }}>
            <span className="material-symbols-outlined fs-5 me-1">light_mode</span>
            <span>{t('color_mode_settings.light')}</span>
          </ColorModeSettingsButton>

          <ColorModeSettingsButton isActive={isActive(Themes.DARK)} onClick={() => { setTheme(Themes.DARK) }}>
            <span className="material-symbols-outlined fs-5 me-1">dark_mode</span>
            <span>{t('color_mode_settings.dark')}</span>
          </ColorModeSettingsButton>

          <ColorModeSettingsButton isActive={isActive(Themes.SYSTEM)} onClick={() => { setTheme(Themes.SYSTEM) }}>
            <span className="material-symbols-outlined fs-5 me-1">devices</span>
            <span>{t('color_mode_settings.system')}</span>
          </ColorModeSettingsButton>

        </div>

        <div className="mt-3 text-muted small">
          {/* eslint-disable-next-line react/no-danger */}
          <span dangerouslySetInnerHTML={{ __html: t('color_mode_settings.description') }} />
        </div>
      </div>
    </div>
  );
};
