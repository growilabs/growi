import React, { useCallback, useEffect, useState } from 'react';

import { useTranslation } from 'next-i18next';

import { apiv3Put } from '~/client/util/apiv3-client';
import { toastSuccess, toastError, toastWarning } from '~/client/util/toastr';
import { useSWRxGrowiTheme } from '~/stores/admin/customize';

import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

import CustomizeThemeOptions from './CustomizeThemeOptions';

// eslint-disable-next-line @typescript-eslint/ban-types
type Props = {
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CustomizeThemeSetting = (props: Props): JSX.Element => {
  const { t } = useTranslation();

  const { data: currentTheme, error } = useSWRxGrowiTheme();
  const [selectedTheme, setSelectedTheme] = useState(currentTheme);

  useEffect(() => {
    setSelectedTheme(currentTheme);
  }, [currentTheme]);

  const selectedHandler = useCallback((themeName: string) => {
    setSelectedTheme(themeName);
  }, []);

  const submitHandler = useCallback(async() => {
    if (selectedTheme == null) {
      toastWarning('The selected theme is undefined');
      return;
    }

    try {
      await apiv3Put('/customize-setting/theme', {
        theme: selectedTheme,
      });

      toastSuccess(t('toaster.update_successed', { target: t('admin:customize_settings.theme'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }, [selectedTheme, t]);

  return (
    <div className="row">
      <div className="col-12">
        <h2 className="admin-setting-header">{t('admin:customize_settings.theme')}</h2>
        <CustomizeThemeOptions onSelected={selectedHandler} selectedTheme={selectedTheme} />
        <AdminUpdateButtonRow onClick={submitHandler} disabled={error != null} />
      </div>
    </div>
  );
};

export default CustomizeThemeSetting;
