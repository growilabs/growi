import React, { useCallback, type JSX } from 'react';

import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import { Card, CardBody } from 'reactstrap';

import { toastSuccess, toastError } from '~/client/util/toastr';
import { useNextThemes } from '~/stores-universal/use-next-themes';
import { useSWRxSidebarConfig } from '~/stores/admin/sidebar-config';

const CustomizeSidebarsetting = (): JSX.Element => {
  const { t } = useTranslation(['admin', 'commons']);

  const {
    data, update, setIsSidebarCollapsedMode,
  } = useSWRxSidebarConfig();

  const { resolvedTheme } = useNextThemes();
  const collapsedIconFileName = `/images/customize-settings/collapsed-${resolvedTheme}.svg`;
  const dockIconFileName = `/images/customize-settings/dock-${resolvedTheme}.svg`;

  const onClickSubmit = useCallback(async() => {
    try {
      await update();
      toastSuccess(t('toaster.update_successed', { target: t('customize_settings.default_sidebar_mode.title'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }, [t, update]);

  if (data == null) {
    return <LoadingSpinner />;
  }

  const { isSidebarCollapsedMode } = data;

  return (
    <React.Fragment>
      <div className="row">
        <div className="col-12">

          <h2 className="admin-setting-header">{t('customize_settings.default_sidebar_mode.title')}</h2>

          <Card className="card custom-card bg-body-tertiary my-3">
            <CardBody className="px-0 py-2">
              {t('customize_settings.default_sidebar_mode.desc')}
            </CardBody>
          </Card>

          <div className="d-flex justify-content-around mt-5">
            <div className="row row-cols-2">
              <div className="col">
                <div
                  className={`card border border-4 ${isSidebarCollapsedMode ? 'border-primary' : ''}`}
                  onClick={() => setIsSidebarCollapsedMode(true)}
                  role="button"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={collapsedIconFileName} alt="Collapsed Mode" />
                  <div className="card-body text-center">
                    Collapsed Mode
                  </div>
                </div>
              </div>
              <div className="col">
                <div
                  className={`card border border-4 ${!isSidebarCollapsedMode ? 'border-primary' : ''}`}
                  onClick={() => setIsSidebarCollapsedMode(false)}
                  role="button"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={dockIconFileName} alt="Dock Mode" />
                  <div className="card-body  text-center">
                    Dock Mode
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="row my-3">
            <div className="mx-auto">
              <button type="button" onClick={onClickSubmit} className="btn btn-primary">{ t('Update') }</button>
            </div>
          </div>

        </div>
      </div>
    </React.Fragment>
  );
};

export default CustomizeSidebarsetting;
