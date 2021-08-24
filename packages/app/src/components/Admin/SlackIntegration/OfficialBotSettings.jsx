import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import loggerFactory from '~/utils/logger';
import AppContainer from '~/client/services/AppContainer';
import { withUnstatedContainers } from '../../UnstatedUtils';
import { toastSuccess, toastError } from '~/client/util/apiNotification';
import CustomBotWithProxyConnectionStatus from './CustomBotWithProxyConnectionStatus';
import WithProxyAccordions from './WithProxyAccordions';
import DeleteSlackBotSettingsModal from './DeleteSlackBotSettingsModal';
import { SlackAppIntegrationControl } from './SlackAppIntegrationControl';

const logger = loggerFactory('growi:cli:SlackIntegration:OfficialBotSettings');

const OfficialBotSettings = (props) => {
  const {
    appContainer, slackAppIntegrations,
    onClickAddSlackWorkspaceBtn, onPrimaryUpdated,
    connectionStatuses, onUpdateTokens, onSubmitForm,
  } = props;
  const [siteName, setSiteName] = useState('');
  const [integrationIdToDelete, setIntegrationIdToDelete] = useState(null);
  const { t } = useTranslation();

  const addSlackAppIntegrationHandler = async() => {
    if (onClickAddSlackWorkspaceBtn != null) {
      onClickAddSlackWorkspaceBtn();
    }
  };

  const isPrimaryChangedHandler = useCallback(async(slackIntegrationToChange, newValue) => {
    // do nothing when turning off
    if (!newValue) {
      return;
    }

    try {
      await appContainer.apiv3.put(`/slack-integration-settings/slack-app-integrations/${slackIntegrationToChange._id}/make-primary`);
      if (onPrimaryUpdated != null) {
        onPrimaryUpdated();
      }
      toastSuccess(t('toaster.update_successed', { target: 'Primary' }));
    }
    catch (err) {
      toastError(err, 'Failed to change isPrimary');
      logger.error('Failed to change isPrimary', err);
    }
  }, [appContainer.apiv3, t, onPrimaryUpdated]);

  const deleteSlackAppIntegrationHandler = async() => {
    await appContainer.apiv3.delete(`/slack-integration-settings/slack-app-integrations/${integrationIdToDelete}`);
    try {
      if (props.onDeleteSlackAppIntegration != null) {
        props.onDeleteSlackAppIntegration();
      }
      toastSuccess(t('admin:slack_integration.toastr.delete_slack_integration_procedure'));
    }
    catch (err) {
      toastError('Failed to delete');
      logger.error('Failed to delete', err);
    }
  };

  useEffect(() => {
    const siteName = appContainer.config.crowi.title;
    setSiteName(siteName);
  }, [appContainer]);

  return (
    <>
      <h2 className="admin-setting-header">{t('admin:slack_integration.official_bot_integration')}
        <a href={t('admin:slack_integration.docs_url.official_bot')} target="_blank" rel="noopener noreferrer">
          <i
            className="fa fa-external-link btn-link ml-2"
            aria-hidden="true"
            onClick={() => window.open(`${t('admin:slack_integration.docs_url.official_bot')}`, '_blank')}
          />
        </a>
      </h2>

      {slackAppIntegrations.length !== 0 && (
        <>
          <CustomBotWithProxyConnectionStatus
            siteName={siteName}
            connectionStatuses={connectionStatuses}
          />

          <h2 className="admin-setting-header">{t('admin:slack_integration.integration_procedure')}</h2>
        </>
      )}

      <div className="mx-3">
        {slackAppIntegrations.map((slackAppIntegration, i) => {
          const {
            tokenGtoP, tokenPtoG, _id, supportedCommandsForBroadcastUse, supportedCommandsForSingleUse,
          } = slackAppIntegration;
          const workspaceName = connectionStatuses[_id]?.workspaceName;
          return (
            <React.Fragment key={slackAppIntegration._id}>
              <div className="my-3 d-flex align-items-center justify-content-between">
                <h2 id={_id || `settings-accordions-${i}`}>
                  {(workspaceName != null) ? `${workspaceName} Work Space` : `Settings #${i}`}
                </h2>
                <SlackAppIntegrationControl
                  slackAppIntegration={slackAppIntegration}
                  onIsPrimaryChanged={isPrimaryChangedHandler}
                  // set state to open DeleteSlackBotSettingsModal
                  onDeleteButtonClicked={saiToDelete => setIntegrationIdToDelete(saiToDelete._id)}
                />
              </div>
              <WithProxyAccordions
                botType="officialBot"
                slackAppIntegrationId={slackAppIntegration._id}
                tokenGtoP={tokenGtoP}
                tokenPtoG={tokenPtoG}
                supportedCommandsForBroadcastUse={supportedCommandsForBroadcastUse}
                supportedCommandsForSingleUse={supportedCommandsForSingleUse}
                onUpdateTokens={onUpdateTokens}
                onSubmitForm={onSubmitForm}
              />
            </React.Fragment>
          );
        })}
        <div className="row justify-content-center my-5">
          <button
            type="button"
            className="btn btn-outline-primary"
            onClick={addSlackAppIntegrationHandler}
          >
            {`+ ${t('admin:slack_integration.accordion.add_slack_workspace')}`}
          </button>
        </div>
      </div>
      <DeleteSlackBotSettingsModal
        isResetAll={false}
        isOpen={integrationIdToDelete != null}
        onClose={() => setIntegrationIdToDelete(null)}
        onClickDeleteButton={deleteSlackAppIntegrationHandler}
      />
    </>

  );
};

const OfficialBotSettingsWrapper = withUnstatedContainers(OfficialBotSettings, [AppContainer]);

OfficialBotSettings.defaultProps = {
  slackAppIntegrations: [],
};

OfficialBotSettings.propTypes = {
  appContainer: PropTypes.instanceOf(AppContainer).isRequired,

  slackAppIntegrations: PropTypes.array,
  onClickAddSlackWorkspaceBtn: PropTypes.func,
  onPrimaryUpdated: PropTypes.func,
  onDeleteSlackAppIntegration: PropTypes.func,
  connectionStatuses: PropTypes.object.isRequired,
  onUpdateTokens: PropTypes.func,
  onSubmitForm: PropTypes.func,
};

export default OfficialBotSettingsWrapper;
