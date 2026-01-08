import React, { useState } from 'react';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

import { apiv3Post } from '~/client/util/apiv3-client';

import Accordion from '../Common/Accordion';
import CustomBotWithoutProxySecretTokenSection from './CustomBotWithoutProxySecretTokenSection';
import ManageCommandsProcessWithoutProxy from './ManageCommandsProcessWithoutProxy';
import MessageBasedOnConnection from './MessageBasedOnConnection';
import { addLogs } from './slack-integration-util';

export const botInstallationStep = {
  CREATE_BOT: 'create-bot',
  INSTALL_BOT: 'install-bot',
  REGISTER_SLACK_CONFIGURATION: 'register-slack-configuration',
  CONNECTION_TEST: 'connection-test',
};

const CustomBotWithoutProxySettingsAccordion = (props) => {
  const {
    activeStep,
    onTestConnectionInvoked,
    slackSigningSecret,
    slackBotToken,
    slackSigningSecretEnv,
    slackBotTokenEnv,
    commandPermission,
    eventActionsPermission,
  } = props;
  const successMessage = 'Successfully sent to Slack workspace.';

  const { t } = useTranslation();
  // eslint-disable-next-line no-unused-vars
  const [defaultOpenAccordionKeys, setDefaultOpenAccordionKeys] = useState(
    new Set([activeStep]),
  );
  const [isLatestConnectionSuccess, setIsLatestConnectionSuccess] =
    useState(false);
  const [testChannel, setTestChannel] = useState('');
  const [logsValue, setLogsValue] = useState('');

  const testConnection = async () => {
    try {
      await apiv3Post('/slack-integration-settings/without-proxy/test', {
        channel: testChannel,
      });
      setIsLatestConnectionSuccess(true);
      if (onTestConnectionInvoked != null) {
        onTestConnectionInvoked();
        const newLogs = addLogs(logsValue, successMessage, null);
        setLogsValue(newLogs);
      }
    } catch (err) {
      setIsLatestConnectionSuccess(false);
      const newLogs = addLogs(logsValue, err[0].message, err[0].code);
      setLogsValue(newLogs);
    }
  };

  const inputTestChannelHandler = (channel) => {
    setTestChannel(channel);
  };

  const submitForm = (e) => {
    e.preventDefault();
    testConnection();
  };

  const slackSigningSecretCombined =
    slackSigningSecret || slackSigningSecretEnv;
  const slackBotTokenCombined = slackBotToken || slackBotTokenEnv;
  const isEnterdSecretAndToken =
    slackSigningSecretCombined != null &&
    slackSigningSecretCombined.length > 0 &&
    slackBotTokenCombined != null &&
    slackBotTokenCombined.length > 0;

  return (
    <div className="accordion">
      <Accordion
        defaultIsActive={defaultOpenAccordionKeys.has(
          botInstallationStep.CREATE_BOT,
        )}
        title={
          <>
            <span className="me-3">1</span>
            {t('admin:slack_integration.accordion.create_bot')}
          </>
        }
      >
        <div className="my-5 d-flex flex-column align-items-center">
          <button
            type="button"
            className="btn btn-primary text-nowrap"
            onClick={() => window.open('https://api.slack.com/apps', '_blank')}
          >
            {t('admin:slack_integration.accordion.create_bot')}
            <span className="growi-custom-icons ms-2">external_link</span>
          </button>
          <a
            href={t(
              'admin:slack_integration.docs_url.custom_bot_without_proxy_setting',
            )}
            target="_blank"
            rel="noopener noreferrer"
          >
            <p className="text-center mt-1">
              <small>
                {t('admin:slack_integration.accordion.how_to_create_a_bot')}
                <span className="growi-custom-icons ms-2">external_link</span>
              </small>
            </p>
          </a>
        </div>
      </Accordion>
      <Accordion
        defaultIsActive={defaultOpenAccordionKeys.has(
          botInstallationStep.INSTALL_BOT,
        )}
        title={
          <>
            <span className="me-3">2</span>
            {t('admin:slack_integration.accordion.install_bot_to_slack')}
          </>
        }
      >
        <div className="container w-75 py-5">
          <p>
            1. {t('admin:slack_integration.accordion.select_install_your_app')}
          </p>
          <img
            src="/images/slack-integration/slack-bot-install-your-app-introduction.png"
            className="border border-light img-fluid mb-5"
            alt=""
          />
          <p>
            2.{' '}
            {t('admin:slack_integration.accordion.select_install_to_workspace')}
          </p>
          <img
            src="/images/slack-integration/slack-bot-install-to-workspace.png"
            className="border border-light img-fluid mb-5"
            alt=""
          />
          <p>3. {t('admin:slack_integration.accordion.click_allow')}</p>
          <img
            src="/images/slack-integration/slack-bot-install-your-app-transition-destination.png"
            className="border border-light img-fluid mb-5"
            alt=""
          />
          <p>
            4.{' '}
            {t('admin:slack_integration.accordion.install_complete_if_checked')}
          </p>
          <img
            src="/images/slack-integration/slack-bot-install-your-app-complete.png"
            className="border border-light img-fluid mb-5"
            alt=""
          />
          <p>
            5. {t('admin:slack_integration.accordion.invite_bot_to_channel')}
          </p>
          <img
            src="/images/slack-integration/slack-bot-install-to-workspace-joined-bot.png"
            className="border border-light img-fluid mb-1"
            alt=""
          />
          <img
            src="/images/slack-integration/slack-bot-install-your-app-introduction-to-channel.png"
            className="border border-light img-fluid"
            alt=""
          />
        </div>
      </Accordion>
      <Accordion
        defaultIsActive={defaultOpenAccordionKeys.has(
          botInstallationStep.REGISTER_SLACK_CONFIGURATION,
        )}
        // eslint-disable-next-line max-len
        title={
          <>
            <span className="me-3">3</span>
            {t('admin:slack_integration.accordion.register_secret_and_token')}
            {isEnterdSecretAndToken && (
              <span className="material-symbols-outlined ms-3 text-success">
                check
              </span>
            )}
          </>
        }
      >
        <CustomBotWithoutProxySecretTokenSection
          onUpdatedSecretToken={props.onUpdatedSecretToken}
          slackSigningSecret={slackSigningSecret}
          slackSigningSecretEnv={slackSigningSecretEnv}
          slackBotToken={slackBotToken}
          slackBotTokenEnv={slackBotTokenEnv}
        />
      </Accordion>
      <Accordion
        defaultIsActive={defaultOpenAccordionKeys.has(
          botInstallationStep.CONNECTION_TEST,
        )}
        // eslint-disable-next-line max-len
        title={
          <>
            <span className="me-3">4</span>
            {t('admin:slack_integration.accordion.manage_permission')}
          </>
        }
      >
        <ManageCommandsProcessWithoutProxy
          commandPermission={commandPermission}
          eventActionsPermission={eventActionsPermission}
        />
      </Accordion>
      <Accordion
        defaultIsActive={defaultOpenAccordionKeys.has(
          botInstallationStep.CONNECTION_TEST,
        )}
        // eslint-disable-next-line max-len
        title={
          <>
            <span className="me-3">5</span>
            {t('admin:slack_integration.accordion.test_connection')}
            {isLatestConnectionSuccess && (
              <span className="material-symbols-outlined ms-3 text-success">
                check
              </span>
            )}
          </>
        }
      >
        <p className="text-center m-4">
          {t(
            'admin:slack_integration.accordion.test_connection_by_pressing_button',
          )}
        </p>
        <p className="text-center text-warning">
          <span className="material-symbols-outlined">info</span>
          {t(
            'admin:slack_integration.accordion.test_connection_only_public_channel',
          )}
        </p>
        <div className="d-flex justify-content-center">
          <form className="align-items-center" onSubmit={(e) => submitForm(e)}>
            <div className="input-group col-8">
              <div>
                <span className="input-group-text" id="slack-channel-addon">
                  <span className="material-symbols-outlined">tag</span>
                </span>
              </div>
              <input
                className="form-control"
                type="text"
                value={testChannel}
                placeholder="Slack Channel"
                onChange={(e) => inputTestChannelHandler(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn btn-info mx-3 fw-bold"
              disabled={testChannel.trim().length === 0}
            >
              Test
            </button>
          </form>
        </div>

        <MessageBasedOnConnection
          isLatestConnectionSuccess={isLatestConnectionSuccess}
          logsValue={logsValue}
        />

        <form>
          <div className="row my-3 justify-content-center">
            <div className="slack-connection-log col-md-4">
              <div className="form-label mb-1">
                <p className="border-info slack-connection-log-title ps-2 m-0">
                  Logs
                </p>
              </div>
              <textarea
                className="form-control card border-info slack-connection-log-body rounded-3"
                rows="5"
                value={logsValue}
                readOnly
              />
            </div>
          </div>
        </form>
      </Accordion>
    </div>
  );
};

CustomBotWithoutProxySettingsAccordion.propTypes = {
  activeStep: PropTypes.oneOf(Object.values(botInstallationStep)).isRequired,

  onUpdatedSecretToken: PropTypes.func,
  onTestConnectionInvoked: PropTypes.func,

  slackSigningSecret: PropTypes.string,
  slackSigningSecretEnv: PropTypes.string,
  slackBotToken: PropTypes.string,
  slackBotTokenEnv: PropTypes.string,
  commandPermission: PropTypes.object,
  eventActionsPermission: PropTypes.object,
};

export default CustomBotWithoutProxySettingsAccordion;
