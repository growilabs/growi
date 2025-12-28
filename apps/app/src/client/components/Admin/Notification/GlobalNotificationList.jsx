import React from 'react';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';
import urljoin from 'url-join';

import AdminNotificationContainer from '~/client/services/AdminNotificationContainer';
import { apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import loggerFactory from '~/utils/logger';

import { withUnstatedContainers } from '../../UnstatedUtils';
import NotificationDeleteModal from './NotificationDeleteModal';
import { NotificationTypeIcon } from './NotificationTypeIcon';

const logger = loggerFactory('growi:GolobalNotificationList');

class GlobalNotificationList extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      isConfirmationModalOpen: false,
      notificationForConfiguration: null,
    };

    this.openConfirmationModal = this.openConfirmationModal.bind(this);
    this.closeConfirmationModal = this.closeConfirmationModal.bind(this);
    this.onClickSubmit = this.onClickSubmit.bind(this);
  }

  async toggleIsEnabled(notification) {
    const { t } = this.props;
    const isEnabled = !notification.isEnabled;
    try {
      await apiv3Put(
        `/notification-setting/global-notification/${notification._id}/enabled`,
        {
          isEnabled,
        },
      );
      toastSuccess(
        t('notification_settings.toggle_notification', {
          path: notification.triggerPath,
        }),
      );
      await this.props.adminNotificationContainer.retrieveNotificationData();
    } catch (err) {
      toastError(err);
      logger.error(err);
    }
  }

  openConfirmationModal(notification) {
    this.setState({
      isConfirmationModalOpen: true,
      notificationForConfiguration: notification,
    });
  }

  closeConfirmationModal() {
    this.setState({
      isConfirmationModalOpen: false,
      notificationForConfiguration: null,
    });
  }

  async onClickSubmit() {
    const { t, adminNotificationContainer } = this.props;

    try {
      const deletedNotificaton =
        await adminNotificationContainer.deleteGlobalNotificationPattern(
          this.state.notificationForConfiguration._id,
        );
      toastSuccess(
        t('notification_settings.delete_notification_pattern', {
          path: deletedNotificaton.triggerPath,
        }),
      );
    } catch (err) {
      toastError(err);
      logger.error(err);
    }
    this.setState({ isConfirmationModalOpen: false });
  }

  render() {
    const { t, adminNotificationContainer } = this.props;
    const { globalNotifications } = adminNotificationContainer.state;

    return (
      <React.Fragment>
        {globalNotifications.map((notification) => {
          return (
            <tr key={notification._id}>
              <td className="align-middle td-abs-center">
                <div className="form-check form-switch form-check-success">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    id={notification._id}
                    defaultChecked={notification.isEnabled}
                    onClick={() => this.toggleIsEnabled(notification)}
                  />
                  <label
                    className="form-label form-check-label"
                    htmlFor={notification._id}
                  />
                </div>
              </td>
              <td>{notification.triggerPath}</td>
              <td>
                <ul className="list-inline mb-0">
                  {notification.triggerEvents.includes('pageCreate') && (
                    <li className="list-inline-item badge rounded-pill bg-success">
                      <span className=" material-symbols-outlined">
                        description
                      </span>{' '}
                      CREATE
                    </li>
                  )}
                  {notification.triggerEvents.includes('pageEdit') && (
                    <li className="list-inline-item badge rounded-pill bg-warning text-dark">
                      <span className="material-symbols-outlined">edit</span>{' '}
                      EDIT
                    </li>
                  )}
                  {notification.triggerEvents.includes('pageMove') && (
                    <li className="list-inline-item badge rounded-pill bg-pink">
                      <span className="material-symbols-outlined">redo</span>{' '}
                      MOVE
                    </li>
                  )}
                  {notification.triggerEvents.includes('pageDelete') && (
                    <li className="list-inline-item badge rounded-pill bg-danger">
                      <span className="material-symbols-outlined">
                        delete_forever
                      </span>
                      DELETE
                    </li>
                  )}
                  {notification.triggerEvents.includes('pageLike') && (
                    <li className="list-inline-item badge rounded-pill bg-info">
                      <span className="material-symbols-outlined">
                        favorite
                      </span>{' '}
                      LIKE
                    </li>
                  )}
                  {notification.triggerEvents.includes('comment') && (
                    <li className="list-inline-item badge rounded-pill bg-primary">
                      <span className="material-symbols-outlined">
                        bubble_chart
                      </span>{' '}
                      POST
                    </li>
                  )}
                </ul>
              </td>
              <td>
                <NotificationTypeIcon notification={notification} />
                {notification.__t === 'mail' && notification.toEmail}
                {notification.__t === 'slack' && notification.slackChannels}
              </td>
              <td className="td-abs-center">
                <div className="dropdown">
                  <button
                    className="btn btn-outline-secondary dropdown-toggle"
                    type="button"
                    id="dropdownMenuButton"
                    data-bs-toggle="dropdown"
                    aria-haspopup="true"
                    aria-expanded="false"
                  >
                    <span className="material-symbols-outlined">settings</span>{' '}
                    <span className="caret"></span>
                  </button>
                  <div
                    className="dropdown-menu dropdown-menu-right"
                    aria-labelledby="dropdownMenuButton"
                  >
                    <a
                      className="dropdown-item"
                      href={urljoin(
                        '/admin/global-notification/',
                        notification._id,
                      )}
                    >
                      <span className="material-symbols-outlined">note</span>{' '}
                      {t('Edit')}
                    </a>
                    <button
                      className="dropdown-item"
                      type="button"
                      onClick={() => this.openConfirmationModal(notification)}
                    >
                      <span className="material-symbols-outlined text-danger">
                        delete_forever
                      </span>{' '}
                      {t('Delete')}
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          );
        })}
        {this.state.notificationForConfiguration != null && (
          <NotificationDeleteModal
            isOpen={this.state.isConfirmationModalOpen}
            onClose={this.closeConfirmationModal}
            onClickSubmit={this.onClickSubmit}
            notificationForConfiguration={
              this.state.notificationForConfiguration
            }
          />
        )}
      </React.Fragment>
    );
  }
}

GlobalNotificationList.propTypes = {
  t: PropTypes.func.isRequired, // i18next
  adminNotificationContainer: PropTypes.instanceOf(AdminNotificationContainer)
    .isRequired,
};

const GlobalNotificationListWrapperFC = (props) => {
  const { t } = useTranslation('admin');

  return <GlobalNotificationList t={t} {...props} />;
};

const GlobalNotificationListWrapper = withUnstatedContainers(
  GlobalNotificationListWrapperFC,
  [AdminNotificationContainer],
);

export default GlobalNotificationListWrapper;
