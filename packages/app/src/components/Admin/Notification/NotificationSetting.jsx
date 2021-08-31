import React, {
  useCallback, useEffect, useMemo, useState,
} from 'react';
import PropTypes from 'prop-types';

import {
  TabContent, TabPane,
} from 'reactstrap';
import { useTranslation } from 'react-i18next';

import { SlackbotType } from '@growi/slack';

import loggerFactory from '~/utils/logger';

import { withUnstatedContainers } from '../../UnstatedUtils';
import { toastError } from '~/client/util/apiNotification';
import { toArrayIfNot } from '~/utils/array-utils';
import { withLoadingSppiner } from '../../SuspenseUtils';

import AdminNotificationContainer from '~/client/services/AdminNotificationContainer';

import { CustomNavTab } from '../../CustomNavigation/CustomNav';

import UserTriggerNotification from './UserTriggerNotification';
import GlobalNotification from './GlobalNotification';

const logger = loggerFactory('growi:NotificationSetting');

let retrieveErrors = null;


// eslint-disable-next-line react/prop-types
const Badge = ({ isEnabled }) => {
  const { t } = useTranslation();

  return isEnabled
    ? <span className="badge badge-success">{t('admin:external_notification.enabled')}</span>
    : <span className="badge badge-secondary">{t('admin:external_notification.disabled')}</span>;
};

const SkeltonListItem = () => (
  <li className="list-group-item">
    <h4 className="mb-2">
      <span className="badge badge-secondary">――</span>
      <span className="ml-2">...</span>
    </h4>
  </li>
);

// eslint-disable-next-line react/prop-types
const SlackIntegrationListItem = ({ isEnabled, currentBotType }) => {
  const { t } = useTranslation();

  const isCautionVisible = currentBotType === SlackbotType.OFFICIAL || currentBotType === SlackbotType.CUSTOM_WITH_PROXY;

  return (
    <li className="list-group-item">
      <h4>
        <Badge isEnabled={isEnabled} />
        <a href="/admin/slack-integration" className="ml-2">{t('slack_integration')}</a>
      </h4>
      { isCautionVisible && (
        <ul className="mt-2 pl-4">
          {/* eslint-disable-next-line react/no-danger */}
          <li dangerouslySetInnerHTML={{ __html: t('admin:external_notification.caution_enabled') }} />
        </ul>
      ) }
    </li>
  );
};

// eslint-disable-next-line react/prop-types
const LegacySlackIntegrationListItem = ({ isEnabled }) => {
  const { t } = useTranslation();

  return (
    <li className="list-group-item">
      <h4>
        <Badge isEnabled={isEnabled} />
        <a href="/admin/slack-integration-legacy" className="ml-2">{t('legacy_slack_integration')}</a>
      </h4>
      { isEnabled && (
        <ul className="mt-2 pl-4">
          <li>
            {/* eslint-disable-next-line react/no-danger */}
            <span className="text-danger" dangerouslySetInnerHTML={{ __html: t('admin:slack_integration_legacy.alert_deplicated') }}></span>
          </li>
        </ul>
      ) }
    </li>
  );
};

function NotificationSetting(props) {
  const { adminNotificationContainer } = props;

  const { t } = useTranslation();

  const [isMounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState('user_trigger_notification');
  const [activeComponents, setActiveComponents] = useState(new Set(['user_trigger_notification']));

  const switchActiveTab = (selectedTab) => {
    setActiveTab(selectedTab);
    setActiveComponents(activeComponents.add(selectedTab));
  };

  const fetchData = useCallback(async() => {
    try {
      await adminNotificationContainer.retrieveNotificationData();
    }
    catch (err) {
      const errs = toArrayIfNot(err);
      toastError(errs);
      logger.error(errs);
      retrieveErrors = errs;
    }
    finally {
      setMounted(true);
    }
  }, [adminNotificationContainer]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const navTabMapping = useMemo(() => {
    return {
      user_trigger_notification: {
        Icon: () => <i className="icon-settings" />,
        i18n: 'User trigger notification',
        index: 0,
      },
      global_notification: {
        Icon: () => <i className="icon-settings" />,
        i18n: 'Global notification',
        index: 1,
      },
    };
  }, []);

  const { isSlackbotConfigured, isSlackLegacyConfigured, currentBotType } = adminNotificationContainer.state;
  const isSlackEnabled = isSlackbotConfigured;
  const isSlackLegacyEnabled = !isSlackbotConfigured && isSlackLegacyConfigured;

  return (
    <>
      <h2 className="admin-setting-header">{t('admin:external_notification.header_status')}</h2>
      <ul className="list-group">
        { !isMounted && <SkeltonListItem />}
        { isMounted && (
          <>
            <SlackIntegrationListItem isEnabled={isSlackEnabled} currentBotType={currentBotType} />
            {/* Legacy Slack Integration become visible only when new Slack Integration is disabled */}
            { !isSlackEnabled && <LegacySlackIntegrationListItem isEnabled={isSlackLegacyEnabled} /> }
          </>
        ) }
      </ul>


      <h2 className="admin-setting-header mt-5">{t('Notification Settings')}</h2>

      <CustomNavTab activeTab={activeTab} navTabMapping={navTabMapping} onNavSelected={switchActiveTab} hideBorderBottom />

      <TabContent activeTab={activeTab} className="p-5">
        <TabPane tabId="user_trigger_notification">
          {activeComponents.has('user_trigger_notification') && <UserTriggerNotification />}
        </TabPane>
        <TabPane tabId="global_notification">
          {activeComponents.has('global_notification') && <GlobalNotification />}
        </TabPane>
      </TabContent>
    </>
  );
}

const NotificationSettingWithUnstatedContainer = withUnstatedContainers(withLoadingSppiner(NotificationSetting), [AdminNotificationContainer]);

NotificationSetting.propTypes = {
  adminNotificationContainer: PropTypes.instanceOf(AdminNotificationContainer).isRequired,
};

export default NotificationSettingWithUnstatedContainer;
