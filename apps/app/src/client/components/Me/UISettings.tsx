import { useCallback, type JSX } from 'react';

import { useTranslation } from 'react-i18next';
import { UncontrolledTooltip } from 'reactstrap';

import { updateUserUISettings } from '~/client/services/user-ui-settings';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { useSetPreferCollapsedMode, useSidebarMode, useCollapsedContentsOpened } from '~/states/ui/sidebar';

import styles from './UISettings.module.scss';

const IconWithTooltip = ({
  id, label, children, additionalClasses,
}: {
id: string,
label: string,
children: JSX.Element,
additionalClasses: string
}) => (
  <>
    <div id={id} className={`${additionalClasses != null ? additionalClasses : ''}`}>{children}</div>
    <UncontrolledTooltip placement="bottom" fade={false} target={id}>{label}</UncontrolledTooltip>
  </>
);

export const UISettings = (): JSX.Element => {
  const { t } = useTranslation();
  const {
    isDockMode, isCollapsedMode,
  } = useSidebarMode();
  const setPreferCollapsedMode = useSetPreferCollapsedMode();
  const [, setCollapsedContentsOpened] = useCollapsedContentsOpened();

  const toggleCollapsed = useCallback(() => {
    setPreferCollapsedMode(!isCollapsedMode());
    setCollapsedContentsOpened(false);
  }, [setPreferCollapsedMode, isCollapsedMode, setCollapsedContentsOpened]);

  const updateButtonHandler = useCallback(async() => {
    try {
      await updateUserUISettings({ preferCollapsedModeByUser: isCollapsedMode() });
      toastSuccess(t('toaster.update_successed', { target: t('ui_settings.side_bar_mode.settings'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }

  }, [isCollapsedMode, t]);

  const renderSidebarModeSwitch = () => {
    return (
      <>
        <div className="d-flex align-items-start">
          <div className="d-flex align-items-center">
            <IconWithTooltip
              id="iwt-sidebar-collapsed"
              label="Collapsed"
              additionalClasses={styles['grw-sidebar-mode-icon']}
            >
              <span className="growi-custom-icons fs-6">sidebar-collapsed</span>
            </IconWithTooltip>
            <div className="form-check form-switch ms-1">

              <input
                id="swSidebarMode"
                className="form-check-input"
                type="checkbox"
                checked={isDockMode()}
                onChange={toggleCollapsed}
              />
              <label className="form-label form-check-label" htmlFor="swSidebarMode"></label>
            </div>
            <IconWithTooltip id="iwt-sidebar-dock" label="Dock" additionalClasses={styles['grw-sidebar-mode-icon']}>
              <span className="growi-custom-icons fs-6">sidebar-dock</span>
            </IconWithTooltip>
          </div>
          <div className="ms-2">
            <label className="form-label form-check-label" htmlFor="swSidebarMode">
              {t('ui_settings.side_bar_mode.side_bar_mode_setting')}
            </label>
          </div>
        </div>
        <p className="form-text text-muted small">{t('ui_settings.side_bar_mode.description')}</p>
      </>
    );
  };

  return (
    <>
      <h2 className="border-bottom pb- mb-4 fs-4">{t('ui_settings.ui_settings')}</h2>

      <div className="row justify-content-center">
        <div className="col-md-6">

          { renderSidebarModeSwitch() }

          <div>
          </div>
        </div>
      </div>

      <div className="row my-3">
        <div className="offset-4 col-5">
          <button data-testid="grw-ui-settings-update-btn" type="button" className="btn btn-primary" onClick={updateButtonHandler}>
            {t('Update')}
          </button>
        </div>
      </div>
    </>
  );
};
