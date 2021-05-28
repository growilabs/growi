import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';
import loggerFactory from '@alias/logger';
import AppContainer from '../../../services/AppContainer';
import { withUnstatedContainers } from '../../UnstatedUtils';
import { toastSuccess, toastError } from '../../../util/apiNotification';
import CustomBotWithProxyIntegrationCard from './CustomBotWithProxyIntegrationCard';
import WithProxyAccordions from './WithProxyAccordions';
import DeleteSlackBotSettingsModal from './DeleteSlackBotSettingsModal';

const logger = loggerFactory('growi:SlackBotSettings');

const CustomBotWithProxySettings = (props) => {
  const {
    appContainer, slackAppIntegrations, proxyServerUri, onClickAddSlackWorkspaceBtn, connectionStatuses,
  } = props;
  const [newProxyServerUri, setNewProxyServerUri] = useState();
  const [integrationIdToDelete, setIntegrationIdToDelete] = useState(null);
  const [siteName, setSiteName] = useState('');
  const { t } = useTranslation();

  const workspaceNameObjects = Object.values(connectionStatuses);
  const workspaceNames = workspaceNameObjects.map((w) => {
    return w.workspaceName;
  });

  useEffect(() => {
    if (proxyServerUri != null) {
      setNewProxyServerUri(proxyServerUri);
    }
  }, [proxyServerUri]);

  const fetchSlackIntegrationData = () => {
    if (props.fetchSlackIntegrationData != null) {
      props.fetchSlackIntegrationData();
    }
  };

  const addSlackAppIntegrationHandler = async() => {
    if (onClickAddSlackWorkspaceBtn != null) {
      onClickAddSlackWorkspaceBtn();
    }
  };

  const deleteSlackAppIntegrationHandler = async() => {
    try {
      // GW-6068 set new value after this
      await appContainer.apiv3.delete('/slack-integration-settings/slack-app-integration', { integrationIdToDelete });
      fetchSlackIntegrationData();
      toastSuccess(t('toaster.update_successed', { target: 'Token' }));
    }
    catch (err) {
      toastError(err);
      logger.error(err);
    }
  };

  const generateAccessTokens = async() => {
    try {
      //  TODO: imprement regenerating tokens by GW-6068
    }
    catch (err) {
      toastError(err);
      logger.error(err);
    }
  };

  const updateProxyUri = async() => {
    try {
      await appContainer.apiv3.put('/slack-integration-settings/proxy-uri', {
        proxyUri: newProxyServerUri,
      });
      toastSuccess(t('toaster.update_successed', { target: 'Proxy URL' }));
    }
    catch (err) {
      toastError(err);
      logger.error(err);
    }
  };

  useEffect(() => {
    const siteName = appContainer.config.crowi.title;
    setSiteName(siteName);
  }, [appContainer]);

  return (
    <>
      <h2 className="admin-setting-header mb-2">{t('admin:slack_integration.custom_bot_with_proxy_integration')}</h2>

      {/* TODO delete tmp props */}
      <CustomBotWithProxyIntegrationCard
        siteName={siteName}
        slackWorkSpaces={
          [
            { name: 'wsName1', active: true },
            { name: 'wsName2', active: false },
          ]
        }
        isSlackScopeSet
      />

      <div className="form-group row my-4">
        <label className="text-left text-md-right col-md-3 col-form-label mt-3">Proxy URL</label>
        <div className="col-md-6 mt-3">
          <input
            className="form-control"
            type="text"
            name="settingForm[proxyUrl]"
            defaultValue={newProxyServerUri}
            onChange={(e) => { setNewProxyServerUri(e.target.value) }}
          />
        </div>
        <div className="col-md-2 mt-3 text-center text-md-left">
          <button type="button" className="btn btn-primary" onClick={updateProxyUri}>{ t('Update') }</button>
        </div>
      </div>

      <h2 className="admin-setting-header">{t('admin:slack_integration.integration_procedure')}</h2>
      <div className="mx-3">
        {slackAppIntegrations.map((slackAppIntegration, i) => {
          const { tokenGtoP, tokenPtoG } = slackAppIntegration;
          return (
            <React.Fragment key={slackAppIntegration._id}>
              <div className="d-flex justify-content-end">
                <button
                  className="my-3 btn btn-outline-danger"
                  type="button"
                  onClick={() => setIntegrationIdToDelete(slackAppIntegration._id)}
                >
                  <i className="icon-trash mr-1" />
                  {t('admin:slack_integration.delete')}
                </button>
              </div>
              {proxyServerUri != null && workspaceNames[i] == null
              && (<>Settings #{i + 1} <span className="text-danger">{t('admin:slack_integration.integration_failed')}</span></>)}
              <WithProxyAccordions
                botType="customBotWithProxy"
                slackAppIntegrationId={slackAppIntegration._id}
                onClickGenerateTokenBtn={generateAccessTokens}
                tokenGtoP={tokenGtoP}
                tokenPtoG={tokenPtoG}
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

const CustomBotWithProxySettingsWrapper = withUnstatedContainers(CustomBotWithProxySettings, [AppContainer]);

CustomBotWithProxySettings.defaultProps = {
  slackAppIntegrations: [],
};

CustomBotWithProxySettings.propTypes = {
  appContainer: PropTypes.instanceOf(AppContainer).isRequired,
  slackAppIntegrations: PropTypes.array,
  proxyServerUri: PropTypes.string,
  onClickAddSlackWorkspaceBtn: PropTypes.func,
  fetchSlackIntegrationData: PropTypes.func,
  connectionStatuses: PropTypes.object.isRequired,
};

export default CustomBotWithProxySettingsWrapper;
