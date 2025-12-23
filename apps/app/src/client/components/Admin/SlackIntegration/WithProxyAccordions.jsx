/* eslint-disable react/prop-types */
import React, { useState } from 'react';

import { SlackbotType } from '@growi/slack';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

import { apiv3Put, apiv3Post } from '~/client/util/apiv3-client';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { useSiteUrlWithEmptyValueWarn } from '~/states/global';
import loggerFactory from '~/utils/logger';

import CustomCopyToClipBoard from '../../Common/CustomCopyToClipBoard';
import Accordion from '../Common/Accordion';

import ManageCommandsProcess from './ManageCommandsProcess';
import MessageBasedOnConnection from './MessageBasedOnConnection';
import { addLogs } from './slack-integration-util';

const logger = loggerFactory('growi:SlackIntegration:WithProxyAccordionsWrapper');

const BotCreateProcess = () => {
  const { t } = useTranslation();
  return (
    <div className="my-5 d-flex flex-column align-items-center">
      <button type="button" className="btn btn-primary text-nowrap" onClick={() => window.open('https://api.slack.com/apps', '_blank')}>
        {t('admin:slack_integration.accordion.create_bot')}
        <span className="growi-custom-icons ms-2">external_link</span>
      </button>
      <a
        href={t('admin:slack_integration.docs_url.custom_bot_with_proxy_setting')}
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
  );
};

const BotInstallProcessForOfficialBot = () => {
  const { t } = useTranslation();
  return (
    <div className="my-5 d-flex flex-column align-items-center">
      <button type="button" className="btn btn-primary text-nowrap" onClick={() => window.open('https://slackbot-proxy.growi.org/', '_blank')}>
        {t('admin:slack_integration.accordion.install_now')}
        <span className="growi-custom-icons ms-2">external_link</span>
      </button>
      <a
        href={t('admin:slack_integration.docs_url.official_bot_setting')}
        target="_blank"
        rel="noopener noreferrer"
      >
        <p className="text-center mt-1">
          <small>
            {t('admin:slack_integration.accordion.how_to_install')}
            <span className="growi-custom-icons ms-2">external_link</span>
          </small>
        </p>
      </a>
    </div>
  );
};

const BotInstallProcessForCustomBotWithProxy = () => {
  const { t } = useTranslation();
  return (
    <div className="container w-75 py-5">
      <p>1. {t('admin:slack_integration.accordion.go-to-manage-distribution')}</p>
      <p>2. {t('admin:slack_integration.accordion.activate-public-distribution')}</p>
      <img src="/images/slack-integration/activate-public-dist.png" className="border border-light img-fluid mb-5" />
      <p>3. {t('admin:slack_integration.accordion.click-add-to-slack-button')}</p>
      <img src="/images/slack-integration/click-add-to-slack.png" className="border border-light img-fluid mb-5" />
      <p>4. {t('admin:slack_integration.accordion.click_allow')}</p>
      <img src="/images/slack-integration/slack-bot-install-your-app-transition-destination.png" className="border border-light img-fluid mb-5" />
      <p>5. {t('admin:slack_integration.accordion.install_complete_if_checked')}</p>
      <img src="/images/slack-integration/basicinfo-all-checked.png" className="border border-light img-fluid mb-5" />
      <p>6. {t('admin:slack_integration.accordion.invite_bot_to_channel')}</p>
      <img src="/images/slack-integration/slack-bot-install-to-workspace-joined-bot.png" className="border border-light img-fluid mb-1" />
      <img src="/images/slack-integration/slack-bot-install-your-app-introduction-to-channel.png" className="border border-light img-fluid" />
    </div>
  );
};

const RegisteringProxyUrlProcess = () => {
  const { t } = useTranslation();
  return (
    <div className="container w-75 py-5">
      <ol>
        <li>
          <p
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: t('admin:slack_integration.accordion.copy_proxy_url') }}
          />
          <p>
            <img className="border border-light img-fluid" src="/images/slack-integration/growi-register-sentence.png" />
          </p>
        </li>
        <li>
          <p
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: t('admin:slack_integration.accordion.enter_proxy_url_and_update') }}
          />
          <p>
            <img className="border border-light img-fluid" src="/images/slack-integration/growi-set-proxy-url.png" />
          </p>
          <p className="text-danger">{t('admin:slack_integration.accordion.dont_need_update')}</p>
        </li>
      </ol>
    </div>
  );
};

const GeneratingTokensAndRegisteringProxyServiceProcess = (props) => {
  const { t } = useTranslation();
  const { slackAppIntegrationId } = props;

  const regenerateTokensHandler = async() => {
    try {
      await apiv3Put(`/slack-integration-settings/slack-app-integrations/${slackAppIntegrationId}/regenerate-tokens`);
      if (props.onUpdateTokens != null) {
        props.onUpdateTokens();
      }
      toastSuccess(t('toaster.update_successed', { target: 'Token', ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
      logger.error(err);
    }
  };

  return (
    <div className="py-4 px-5">
      <p className="fw-bold">1. {t('admin:slack_integration.accordion.generate_access_token')}</p>
      <div className="row">
        <label className="text-start text-md-end col-md-3 col-form-label">Access Token Proxy to GROWI</label>
        <div className="col-md-6">
          <div className=" mx-1">
            <input className="form-control" type="text" value={props.tokenPtoG || ''} readOnly />
            <CustomCopyToClipBoard textToBeCopied={props.tokenPtoG || ''} message="admin:slack_integration.copied_to_clipboard"></CustomCopyToClipBoard>
          </div>
        </div>
      </div>
      <div className="row">
        <label className="text-start text-md-end col-md-3 col-form-label">Access Token GROWI to Proxy</label>
        <div className="col-md-6">
          <div className=" mx-1">
            <input className="form-control" type="text" value={props.tokenGtoP || ''} readOnly />
            <CustomCopyToClipBoard textToBeCopied={props.tokenGtoP || ''} message="admin:slack_integration.copied_to_clipboard"></CustomCopyToClipBoard>
          </div>
        </div>
      </div>

      <div className="row my-3">
        <button
          type="button"
          className="btn btn-primary mx-auto"
          onClick={regenerateTokensHandler}
        >
          { t('admin:slack_integration.access_token_settings.regenerate') }
        </button>
      </div>
      <p className="fw-bold mt-5">2. {t('admin:slack_integration.accordion.register_for_growi_official_bot_proxy_service')}</p>
      <div className="d-flex flex-column align-items-center">
        <ol className="p-0">
          <li>
            <p
              className="ms-2"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: t('admin:slack_integration.accordion.enter_growi_register_on_slack') }}
            />
          </li>
          <li>
            <p
              className="ms-2"
              // TODO: Add dynamic link
              // TODO: Add logo
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: t('admin:slack_integration.accordion.paste_growi_url') }}
            />
            <div className="input-group align-items-center ps-2 mb-3">
              <div className="w-75">
                <input className="form-control" type="text" value={props.growiUrl} readOnly />
                <CustomCopyToClipBoard textToBeCopied={props.growiUrl} message="admin:slack_integration.copied_to_clipboard"></CustomCopyToClipBoard>
              </div>
            </div>

          </li>
          <li>
            <p
              className="ms-2"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: t('admin:slack_integration.accordion.enter_access_token_for_growi_and_proxy') }}
            />
          </li>
        </ol>
        <img className="mb-3 border border-light img-fluid" width={500} src="/images/slack-integration/growi-register-modal.png" />
      </div>
    </div>

  );
};

const TestProcess = ({
  slackAppIntegrationId, onSubmitForm, onSubmitFormFailed, isLatestConnectionSuccess,
}) => {

  const { t } = useTranslation();
  const [testChannel, setTestChannel] = useState('');
  const [logsValue, setLogsValue] = useState('');
  const successMessage = 'Successfully sent to Slack workspace.';

  const submitForm = async(e) => {
    e.preventDefault();
    try {
      await apiv3Post(`/slack-integration-settings/slack-app-integrations/${slackAppIntegrationId}/relation-test`, { channel: testChannel });
      const newLogs = addLogs(logsValue, successMessage, null);
      setLogsValue(newLogs);

      if (onSubmitForm != null) {
        onSubmitForm();
      }
    }
    catch (error) {
      const newLogs = addLogs(logsValue, error[0].message, error[0].code);
      setLogsValue(newLogs);
      logger.error(error);
      if (onSubmitFormFailed != null) {
        onSubmitFormFailed();
      }
    }
  };

  return (
    <>
      <p className="text-center m-4">{t('admin:slack_integration.accordion.test_connection_by_pressing_button')}</p>
      <p className="text-center text-warning">
        <span className="material-symbols-outlined me-1">info</span>{t('admin:slack_integration.accordion.test_connection_only_public_channel')}
      </p>
      <div className="d-flex justify-content-center">
        <form className="justify-content-center" onSubmit={e => submitForm(e)}>
          <div className="input-group col-8">
            <div>
              <span className="input-group-text" id="slack-channel-addon"><span className="material-symbols-outlined">tag</span></span>
            </div>
            <input
              className="form-control"
              type="text"
              value={testChannel}
              placeholder="Slack Channel"
              onChange={e => setTestChannel(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn-info mx-3 fw-bold"
            disabled={testChannel.trim() === ''}
          >
            Test
          </button>
        </form>
      </div>
      <MessageBasedOnConnection isLatestConnectionSuccess={isLatestConnectionSuccess} logsValue={logsValue} />
      <form>
        <div className="row my-3 justify-content-center">
          <div className="slack-connection-log col-md-4">
            <label className="form-label mb-1"><p className="border-info slack-connection-log-title ps-2 m-0">Logs</p></label>
            <textarea
              className="form-control card border-info slack-connection-log-body rounded-3"
              rows="5"
              value={logsValue}
              readOnly
            />
          </div>
        </div>
      </form>
    </>
  );
};


const WithProxyAccordions = (props) => {
  const { t } = useTranslation();
  const siteUrl = useSiteUrlWithEmptyValueWarn();
  const [isLatestConnectionSuccess, setIsLatestConnectionSuccess] = useState(false);

  const submitForm = () => {
    setIsLatestConnectionSuccess(true);
    if (props.onSubmitForm != null) {
      props.onSubmitForm();
    }
  };
  const submitFormFailed = () => {
    setIsLatestConnectionSuccess(false);
  };


  const officialBotIntegrationProcedure = {
    1: {
      title: 'install_bot_to_slack',
      content: <BotInstallProcessForOfficialBot />,
    },
    2: {
      title: 'register_for_growi_official_bot_proxy_service',
      content: <GeneratingTokensAndRegisteringProxyServiceProcess
        growiUrl={siteUrl}
        slackAppIntegrationId={props.slackAppIntegrationId}
        tokenPtoG={props.tokenPtoG}
        tokenGtoP={props.tokenGtoP}
        onUpdateTokens={props.onUpdateTokens}
      />,
    },
    3: {
      title: 'manage_permission',
      content: <ManageCommandsProcess
        slackAppIntegrationId={props.slackAppIntegrationId}
        permissionsForBroadcastUseCommands={props.permissionsForBroadcastUseCommands}
        permissionsForSingleUseCommands={props.permissionsForSingleUseCommands}
        permissionsForSlackEventActions={props.permissionsForSlackEventActions}
      />,
    },
    4: {
      title: 'test_connection',
      content: <TestProcess
        slackAppIntegrationId={props.slackAppIntegrationId}
        onSubmitForm={submitForm}
        onSubmitFormFailed={submitFormFailed}
        isLatestConnectionSuccess={isLatestConnectionSuccess}
      />,
    },
  };

  const CustomBotIntegrationProcedure = {
    1: {
      title: 'create_bot',
      content: <BotCreateProcess />,
    },
    2: {
      title: 'install_bot_to_slack',
      content: <BotInstallProcessForCustomBotWithProxy />,
    },
    3: {
      title: 'register_for_growi_custom_bot_proxy',
      content: <GeneratingTokensAndRegisteringProxyServiceProcess
        growiUrl={siteUrl}
        slackAppIntegrationId={props.slackAppIntegrationId}
        tokenPtoG={props.tokenPtoG}
        tokenGtoP={props.tokenGtoP}
        onUpdateTokens={props.onUpdateTokens}
      />,
    },
    4: {
      title: 'set_proxy_url_on_growi',
      content: <RegisteringProxyUrlProcess />,
    },
    5: {
      title: 'manage_permission',
      content: <ManageCommandsProcess
        slackAppIntegrationId={props.slackAppIntegrationId}
        permissionsForBroadcastUseCommands={props.permissionsForBroadcastUseCommands}
        permissionsForSingleUseCommands={props.permissionsForSingleUseCommands}
        permissionsForSlackEventActions={props.permissionsForSlackEventActions}
      />,
    },
    6: {
      title: 'test_connection',
      content: <TestProcess
        slackAppIntegrationId={props.slackAppIntegrationId}
        onSubmitForm={submitForm}
        onSubmitFormFailed={submitFormFailed}
        isLatestConnectionSuccess={isLatestConnectionSuccess}
      />,
    },
  };

  const integrationProcedureMapping = props.botType === SlackbotType.OFFICIAL ? officialBotIntegrationProcedure : CustomBotIntegrationProcedure;

  return (
    <div
      className="accordion"
    >
      {Object.entries(integrationProcedureMapping).map(([key, value]) => {
        return (
          <Accordion
            title={(
              <>
                <span className="me-3">{key}</span>
                {t(`admin:slack_integration.accordion.${value.title}`)}
                {value.title === 'test_connection' && isLatestConnectionSuccess && <span className="material-symbols-outlined ms-3 text-success">check</span>}
              </>
            )}
            key={key}
          >
            {value.content}
          </Accordion>
        );
      })}
    </div>
  );
};


/**
 * Wrapper component for using unstated
 */
WithProxyAccordions.propTypes = {
  botType: PropTypes.oneOf(Object.values(SlackbotType)).isRequired,
  slackAppIntegrationId: PropTypes.string.isRequired,
  tokenPtoG: PropTypes.string,
  tokenGtoP: PropTypes.string,
  permissionsForBroadcastUseCommands: PropTypes.object.isRequired,
  permissionsForSingleUseCommands: PropTypes.object.isRequired,
  permissionsForSlackEventActions: PropTypes.object.isRequired,
};

export default WithProxyAccordions;
