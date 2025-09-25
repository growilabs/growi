import React, {
  useCallback, useEffect, useState, type JSX,
} from 'react';

import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';

import { toastSuccess, toastError } from '~/client/util/toastr';
import { useNextThemes } from '~/stores-universal/use-next-themes';
import { useSWRxLayoutSetting } from '~/stores/admin/customize';

const useIsContainerFluid = () => {
  const { data: layoutSetting, update: updateLayoutSetting } = useSWRxLayoutSetting();
  const [isContainerFluid, setIsContainerFluid] = useState<boolean>();

  useEffect(() => {
    setIsContainerFluid(layoutSetting?.isContainerFluid);
  }, [layoutSetting?.isContainerFluid]);

  return {
    isContainerFluid,
    setIsContainerFluid,
    updateLayoutSetting,
  };
};

const CustomizeLayoutSetting = (): JSX.Element => {
  const { t } = useTranslation('admin');

  const { resolvedTheme } = useNextThemes();

  const { isContainerFluid, setIsContainerFluid, updateLayoutSetting } = useIsContainerFluid();

  const onClickSubmit = useCallback(async() => {
    if (isContainerFluid == null) { return }
    try {
      await updateLayoutSetting({ isContainerFluid });
      toastSuccess(t('toaster.update_successed', { target: t('customize_settings.layout'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }, [isContainerFluid, updateLayoutSetting, t]);

  if (isContainerFluid == null) {
    return (
      <div className="text-muted text-center fs-3">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <React.Fragment>
      <div className="row">
        <div className="col-12">
          <h2 className="admin-setting-header">{t('customize_settings.layout')}</h2>

          <div className="d-flex justify-content-around mt-5">
            <div className="row row-cols-2">
              <div className="col">
                <div
                  className={`card border border-4 ${!isContainerFluid ? 'border-primary' : ''}`}
                  onClick={() => setIsContainerFluid(false)}
                  role="button"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="card-img-top"
                    src={`/images/customize-settings/default-${resolvedTheme}.svg`}
                    alt={t('customize_settings.layout_options.default')}
                  />
                  <div className="card-body text-center">
                    {t('customize_settings.layout_options.default')}
                  </div>
                </div>
              </div>
              <div className="col">
                <div
                  className={`card border border-4 ${isContainerFluid ? 'border-primary' : ''}`}
                  onClick={() => setIsContainerFluid(true)}
                  role="button"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="card-img-top"
                    src={`/images/customize-settings/fluid-${resolvedTheme}.svg`}
                    alt={t('customize_settings.layout_options.expanded')}
                  />
                  <div className="card-body text-center">
                    {t('customize_settings.layout_options.expanded')}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="row my-3">
            <div className="mx-auto">
              <button type="button" className="btn btn-primary" onClick={onClickSubmit}>{ t('Update') }</button>
            </div>
          </div>
        </div>
      </div>
    </React.Fragment>
  );
};

export default CustomizeLayoutSetting;
