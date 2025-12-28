import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SlackbotType } from '@growi/slack';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';
import { TabContent, TabPane } from 'reactstrap';

import AdminNotificationContainer from '~/client/services/AdminNotificationContainer';
import { toastError } from '~/client/util/toastr';
import { toArrayIfNot } from '~/utils/array-utils';
import loggerFactory from '~/utils/logger';

import CustomNav from '../../CustomNavigation/CustomNav';
import { withUnstatedContainers } from '../../UnstatedUtils';
import GlobalNotification from './GlobalNotification';
import UserTriggerNotification from './UserTriggerNotification';

const logger = loggerFactory('growi:NotificationSetting');

let retrieveErrors = null;

// eslint-disable-next-line react/prop-types
const Badge = ({ isEnabled }) => {
  const { t } = useTranslation('admin');

  return isEnabled ? (
    <span className="badge text-bg-success">
      {t('external_notification.enabled')}
    </span>
  ) : (
    <span className="badge text-bg-primary">
      {t('external_notification.disabled')}
    </span>
  );
};

const SkeletonListItem = () => (
  <li className="list-group-item">
    <h4 className="mb-2">
      <span className="badge text-bg-primary">――</span>
      <span className="ms-2">...</span>
    </h4>
  </li>
);

// eslint-disable-next-line react/prop-types
const SlackIntegrationListItem = ({ isEnabled, currentBotType }) => {
  const { t } = useTranslation('admin');

  const isCautionVisible =
    currentBotType === SlackbotType.OFFICIAL ||
    currentBotType === SlackbotType.CUSTOM_WITH_PROXY;

  return (
    <li
      data-testid="slack-integration-list-item"
      className="list-group-item bg-body-tertiary"
    >
      <h4>
        <Badge isEnabled={isEnabled} />
        <a href="/admin/slack-integration" className="ms-2">
          {t('slack_integration.slack_integration')}
        </a>
      </h4>
      {isCautionVisible && (
        <ul className="mt-2 ps-4">
          {/* eslint-disable-next-line react/no-danger */}
          <li
            dangerouslySetInnerHTML={{
              __html: t('external_notification.caution_enabled'),
            }}
          />
        </ul>
      )}
    </li>
  );
};

// eslint-disable-next-line react/prop-types
const LegacySlackIntegrationListItem = ({ isEnabled }) => {
  const { t } = useTranslation('admin');

  return (
    <li className="list-group-item">
      <h4>
        <Badge isEnabled={isEnabled} />
        <a href="/admin/slack-integration-legacy" className="ms-2">
          {t('slack_integration_legacy.slack_integration_legacy')}
        </a>
      </h4>
      {isEnabled && (
        <ul className="mt-2 ps-4">
          <li>
            {/* eslint-disable-next-line react/no-danger */}
            <span
              className="text-danger"
              dangerouslySetInnerHTML={{
                __html: t('slack_integration_legacy.alert_deplicated'),
              }}
            ></span>
          </li>
        </ul>
      )}
    </li>
  );
};

function NotificationSetting(props) {
  const { adminNotificationContainer } = props;

  const { t } = useTranslation('admin');

  const [isMounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState('user_trigger_notification');
  const [activeComponents, setActiveComponents] = useState(
    new Set(['user_trigger_notification']),
  );

  const switchActiveTab = (selectedTab) => {
    setActiveTab(selectedTab);
    setActiveComponents(activeComponents.add(selectedTab));
  };

  const fetchData = useCallback(async () => {
    try {
      await adminNotificationContainer.retrieveNotificationData();
    } catch (err) {
      const errs = toArrayIfNot(err);
      toastError(errs);
      logger.error(errs);
      retrieveErrors = errs;
    } finally {
      setMounted(true);
    }
  }, [adminNotificationContainer]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const navTabMapping = useMemo(() => {
    return {
      user_trigger_notification: {
        Icon: () => <span className="material-symbols-outlined">settings</span>,
        i18n: 'User trigger notification',
      },
      global_notification: {
        Icon: () => <span className="material-symbols-outlined">settings</span>,
        i18n: 'Global notification',
      },
    };
  }, []);

  const { isSlackbotConfigured, isSlackLegacyConfigured, currentBotType } =
    adminNotificationContainer.state;
  const isSlackEnabled = isSlackbotConfigured;
  const isSlackLegacyEnabled = !isSlackbotConfigured && isSlackLegacyConfigured;

  return (
    <div data-testid="admin-notification">
      <h2 className="admin-setting-header">
        {t('external_notification.header_status')}
      </h2>
      <ul className="list-group">
        {!isMounted && <SkeletonListItem />}
        {isMounted && (
          <>
            <SlackIntegrationListItem
              isEnabled={isSlackEnabled}
              currentBotType={currentBotType}
            />
            {/* Legacy Slack Integration become visible only when new Slack Integration is disabled */}
            {!isSlackEnabled && (
              <LegacySlackIntegrationListItem
                isEnabled={isSlackLegacyEnabled}
              />
            )}
          </>
        )}
      </ul>

      <h2 className="admin-setting-header mt-5">
        {t('notification_settings.notification_settings')}
      </h2>

      <CustomNav
        activeTab={activeTab}
        navTabMapping={navTabMapping}
        onNavSelected={switchActiveTab}
        hideBorderBottom
        breakpointToSwitchDropdownDown="md"
      />

      <TabContent activeTab={activeTab} className="p-5">
        <TabPane tabId="user_trigger_notification">
          {activeComponents.has('user_trigger_notification') && (
            <UserTriggerNotification />
          )}
        </TabPane>
        <TabPane tabId="global_notification">
          {activeComponents.has('global_notification') && (
            <GlobalNotification />
          )}
        </TabPane>
      </TabContent>
    </div>
  );
}

const NotificationSettingWithUnstatedContainer = withUnstatedContainers(
  NotificationSetting,
  [AdminNotificationContainer],
);

NotificationSetting.propTypes = {
  adminNotificationContainer: PropTypes.instanceOf(AdminNotificationContainer)
    .isRequired,
};

export default NotificationSettingWithUnstatedContainer;
