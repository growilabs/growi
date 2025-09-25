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
    data, update, setIsSidebarCollapsedMode, setIsSidebarClosedAtDockMode,
  } = useSWRxSidebarConfig();

  const { resolvedTheme } = useNextThemes();
  const drawerIconFileName = `/images/customize-settings/drawer-${resolvedTheme}.svg`;
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

  const { isSidebarCollapsedMode, isSidebarClosedAtDockMode } = data;

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
                  <img src={drawerIconFileName} alt="Drawer Mode" />
                  <div className="card-body text-center">
                    Drawer Mode
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

          <Card className="card custom-card bg-body-tertiary my-5">
            <CardBody className="px-0 py-2">
              {t('customize_settings.default_sidebar_mode.dock_mode_default_desc')}
            </CardBody>
          </Card>

          <div className="px-3">
            <div className="form-check my-3">
              <input
                type="radio"
                id="is-open"
                className="form-check-input"
                checked={isSidebarCollapsedMode === false && isSidebarClosedAtDockMode === false}
                disabled={isSidebarCollapsedMode}
                onChange={() => setIsSidebarClosedAtDockMode(false)}
              />
              <label className="form-label form-check-label" htmlFor="is-open">
                {t('customize_settings.default_sidebar_mode.dock_mode_default_open')}
              </label>
            </div>
            <div className="form-check my-3">
              <input
                type="radio"
                id="is-closed"
                className="form-check-input"
                checked={isSidebarCollapsedMode === false && isSidebarClosedAtDockMode === true}
                disabled={isSidebarCollapsedMode}
                onChange={() => setIsSidebarClosedAtDockMode(true)}
              />
              <label className="form-label form-check-label" htmlFor="is-closed">
                {t('customize_settings.default_sidebar_mode.dock_mode_default_close')}
              </label>
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
