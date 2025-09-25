import React, {
  useCallback, useEffect, useState, type JSX,
} from 'react';

import { PresetThemes, PresetThemesMetadatas } from '@growi/preset-themes';
import { useTranslation } from 'next-i18next';

import { toastSuccess, toastError, toastWarning } from '~/client/util/toastr';
import { useSWRxGrowiThemeSetting } from '~/stores/admin/customize';

import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

import CustomizeThemeOptions from './CustomizeThemeOptions';


// eslint-disable-next-line @typescript-eslint/ban-types
type Props = {
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CustomizeThemeSetting = (props: Props): JSX.Element => {
  const { t } = useTranslation();

  const { data, error, update } = useSWRxGrowiThemeSetting();
  const [currentTheme, setCurrentTheme] = useState(data?.currentTheme);

  useEffect(() => {
    setCurrentTheme(data?.currentTheme);
  }, [data?.currentTheme]);

  const selectedHandler = useCallback((themeName: string) => {
    setCurrentTheme(themeName);
  }, []);

  const submitHandler = useCallback(async() => {
    if (currentTheme == null) {
      toastWarning('The selected theme is undefined');
      return;
    }

    try {
      await update({
        theme: currentTheme,
      });

      toastSuccess(t('toaster.update_successed', { target: t('admin:customize_settings.theme'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }, [currentTheme, t, update]);

  const availableThemes = data?.pluginThemesMetadatas == null
    ? PresetThemesMetadatas
    : PresetThemesMetadatas.concat(data.pluginThemesMetadatas);

  const selectedTheme = availableThemes.find(t => t.name === currentTheme)?.name ?? PresetThemes.DEFAULT;

  return (
    <div className="row">
      <div className="col-12">
        <h2 className="admin-setting-header">{t('admin:customize_settings.theme')}</h2>
        <CustomizeThemeOptions
          onSelected={selectedHandler}
          availableThemes={availableThemes}
          selectedTheme={selectedTheme}
        />
        <AdminUpdateButtonRow onClick={submitHandler} disabled={error != null} />
      </div>
    </div>
  );
};

export default CustomizeThemeSetting;
