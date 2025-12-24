import React, { useState, useEffect } from 'react';

import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

import { useAppTitle } from '~/states/global';

import { CustomBotWithoutProxyConnectionStatus } from './CustomBotWithoutProxyConnectionStatus';
import CustomBotWithoutProxySettingsAccordion, { botInstallationStep } from './CustomBotWithoutProxySettingsAccordion';

const CustomBotWithoutProxySettings = (props) => {
  const { connectionStatuses } = props;
  const { t } = useTranslation();
  const appTitle = useAppTitle();
  const [siteName, setSiteName] = useState('');

  useEffect(() => {
    setSiteName(appTitle);
  }, [appTitle]);

  const workspaceName = connectionStatuses[props.slackBotToken]?.workspaceName;

  return (
    <>
      <h2 className="admin-setting-header">{t('admin:slack_integration.custom_bot_without_proxy_integration')}
        <a href={t('admin:slack_integration.docs_url.custom_bot_without_proxy')} target="_blank" rel="noopener noreferrer">
          <span className="growi-custom-icons btn-link ms-2">external_link</span>
        </a>
      </h2>

      <CustomBotWithoutProxyConnectionStatus
        siteName={siteName}
        connectionStatuses={connectionStatuses}
      />

      <h2 className="admin-setting-header">{t('admin:slack_integration.integration_procedure')}</h2>

      <div className="px-3">
        <div className="my-3 d-flex align-items-center justify-content-between">
          <h2 id={props.slackBotToken || 'settings-accordions'}>
            {(workspaceName != null) ? `${workspaceName} Work Space` : 'Settings'}
          </h2>
        </div>
        <CustomBotWithoutProxySettingsAccordion
          activeStep={botInstallationStep.CREATE_BOT}
          slackBotTokenEnv={props.slackBotTokenEnv}
          slackBotToken={props.slackBotToken}
          slackSigningSecretEnv={props.slackSigningSecretEnv}
          slackSigningSecret={props.slackSigningSecret}
          onTestConnectionInvoked={props.onTestConnectionInvoked}
          onUpdatedSecretToken={props.onUpdatedSecretToken}
          commandPermission={props.commandPermission}
          eventActionsPermission={props.eventActionsPermission}
        />
      </div>
    </>
  );
};


CustomBotWithoutProxySettings.propTypes = {

  slackSigningSecret: PropTypes.string,
  slackSigningSecretEnv: PropTypes.string,
  slackBotToken: PropTypes.string,
  slackBotTokenEnv: PropTypes.string,

  onUpdatedSecretToken: PropTypes.func.isRequired,
  onTestConnectionInvoked: PropTypes.func.isRequired,
  connectionStatuses: PropTypes.object.isRequired,
  commandPermission: PropTypes.object,
  eventActionsPermission: PropTypes.object,
};

export default CustomBotWithoutProxySettings;
