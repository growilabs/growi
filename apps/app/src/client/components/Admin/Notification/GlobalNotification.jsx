import { React, useCallback } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

import AdminNotificationContainer from '~/client/services/AdminNotificationContainer';
import { toastError, toastSuccess } from '~/client/util/toastr';
import loggerFactory from '~/utils/logger';

import { withUnstatedContainers } from '../../UnstatedUtils';
import GlobalNotificationList from './GlobalNotificationList';

const logger = loggerFactory('growi:GlobalNotification');

const GlobalNotification = (props) => {
  const { adminNotificationContainer } = props;
  const { t } = useTranslation('admin');

  const onClickSubmit = useCallback(async () => {
    try {
      await adminNotificationContainer.updateGlobalNotificationForPages();
      toastSuccess(
        t('toaster.update_successed', {
          target: t('external_notification.external_notification'),
          ns: 'commons',
        }),
      );
    } catch (err) {
      toastError(err);
      logger.error(err);
    }
  }, [adminNotificationContainer, t]);

  const router = useRouter();
  const { globalNotifications } = adminNotificationContainer.state;
  return (
    <>
      <h2 className="border-bottom my-4">
        {t('notification_settings.valid_page')}
      </h2>

      <p className="card custom-card bg-body-tertiary">
        {/* eslint-disable-next-line react/no-danger */}
        <span
          dangerouslySetInnerHTML={{
            __html: t('notification_settings.link_notification_help'),
          }}
        />
      </p>
      <div className="row mb-4">
        <div className="col-md-8 offset-md-2">
          <div className="form-check form-check-success">
            <input
              id="isNotificationForOwnerPageEnabled"
              className="form-check-input"
              type="checkbox"
              checked={
                adminNotificationContainer.state
                  .isNotificationForOwnerPageEnabled || false
              }
              onChange={() => {
                adminNotificationContainer.switchIsNotificationForOwnerPageEnabled();
              }}
            />
            <label
              className="form-label form-check-label"
              htmlFor="isNotificationForOwnerPageEnabled"
            >
              {/* eslint-disable-next-line react/no-danger */}
              <span
                dangerouslySetInnerHTML={{
                  __html: t('notification_settings.just_me_notification_help'),
                }}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="row mb-4">
        <div className="col-md-8 offset-md-2">
          <div className="form-check form-check-success">
            <input
              id="isNotificationForGroupPageEnabled"
              className="form-check-input"
              type="checkbox"
              checked={
                adminNotificationContainer.state
                  .isNotificationForGroupPageEnabled || false
              }
              onChange={() => {
                adminNotificationContainer.switchIsNotificationForGroupPageEnabled();
              }}
            />
            <label
              className="form-label form-check-label"
              htmlFor="isNotificationForGroupPageEnabled"
            >
              {/* eslint-disable-next-line react/no-danger */}
              <span
                dangerouslySetInnerHTML={{
                  __html: t('notification_settings.group_notification_help'),
                }}
              />
            </label>
          </div>
        </div>
      </div>
      <div className="row mt-3 mb-5">
        <div className="col-sm-5 offset-sm-4">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onClickSubmit}
            disabled={adminNotificationContainer.state.retrieveError}
          >
            {t('Update')}
          </button>
        </div>
      </div>

      <h2 className="border-bottom mb-3">
        {t('notification_settings.notification_list')}
      </h2>
      <button
        className="btn btn-outline-secondary mb-3"
        type="button"
        onClick={() => router.push('/admin/global-notification/new')}
      >
        {t('notification_settings.add_notification')}
      </button>
      <table className="table table-bordered">
        <thead>
          <tr>
            <th>ON/OFF</th>
            {/* eslint-disable-next-line react/no-danger */}
            <th>
              {t('notification_settings.trigger_path')}{' '}
              <span
                dangerouslySetInnerHTML={{
                  __html: t('notification_settings.trigger_path_help'),
                }}
              />
            </th>
            <th>{t('notification_settings.trigger_events')}</th>
            <th>{t('notification_settings.notify_to')}</th>
            <th></th>
          </tr>
        </thead>
        {globalNotifications.length !== 0 && (
          <tbody className="admin-notif-list">
            <GlobalNotificationList />
          </tbody>
        )}
      </table>
    </>
  );
};

GlobalNotification.propTypes = {
  adminNotificationContainer: PropTypes.instanceOf(AdminNotificationContainer)
    .isRequired,
};

const GlobalNotificationWrapper = withUnstatedContainers(GlobalNotification, [
  AdminNotificationContainer,
]);

export default GlobalNotificationWrapper;
