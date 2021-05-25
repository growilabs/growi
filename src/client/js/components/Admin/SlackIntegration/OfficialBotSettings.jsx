import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import loggerFactory from '@alias/logger';
import { useTranslation } from 'react-i18next';
import AppContainer from '../../../services/AppContainer';
import { withUnstatedContainers } from '../../UnstatedUtils';
import { toastSuccess, toastError } from '../../../util/apiNotification';
import CustomBotWithProxyIntegrationCard from './CustomBotWithProxyIntegrationCard';
import WithProxyAccordions from './WithProxyAccordions';
import DeleteSlackBotSettingsModal from './DeleteSlackBotSettingsModal';

const logger = loggerFactory('growi:SlackBotSettings');

const OfficialBotSettings = (props) => {
  const { appContainer, slackAppIntegrations, proxyServerUri } = props;
  const [isDeleteConfirmModalShown, setIsDeleteConfirmModalShown] = useState(false);
  const { t } = useTranslation();

  const [newProxyServerUri, setNewProxyServerUri] = useState();

  useEffect(() => {
    if (proxyServerUri != null) {
      setNewProxyServerUri(proxyServerUri);
    }
  }, [proxyServerUri]);

  const addSlackAppIntegrationHandler = async() => {
    // TODO GW-6067 implement
  };

  const discardTokenHandler = async(tokenGtoP, tokenPtoG) => {
    try {
      // GW-6068 set new value after this
      await appContainer.apiv3.delete('/slack-integration-settings/slack-app-integration', { tokenGtoP, tokenPtoG });
    }
    catch (err) {
      toastError(err);
      logger(err);
    }
  };

  const generateTokenHandler = async() => {
    try {
      // GW-6068 set new value after this
      await appContainer.apiv3.put('/slack-integration-settings/access-tokens');
    }
    catch (err) {
      toastError(err);
      logger(err);
    }
  };

  const deleteSlackAppIntegrationHandler = async() => {
    try {
      // TODO GW-5923 delete SlackAppIntegration
      // await appContainer.apiv3.put('/slack-integration-settings/custom-bot-with-proxy');
      toastSuccess('success');
    }
    catch (err) {
      toastError(err);
    }
  };

  const updateProxyUri = async() => {
    try {
      await appContainer.apiv3.put('/slack-integration-settings/proxy-uri', {
        proxyUri: newProxyServerUri,
      });
      toastSuccess(t('toaster.update_successed', { target: t('Proxy URL') }));
    }
    catch (err) {
      toastError(err);
      logger.error(err);
    }
  };

  return (
    <>
      <h2 className="admin-setting-header">{t('admin:slack_integration.official_bot_integration')}</h2>
      {/* TODO delete tmp props */}
      <CustomBotWithProxyIntegrationCard
        growiApps={
          [
            { name: 'siteName1', active: true },
            { name: 'siteName2', active: false },
            { name: 'siteName3', active: false },
          ]
        }
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

      <h2 className="admin-setting-header">{t('admin:slack_integration.official_bot_settings')}</h2>

      <div className="mx-3">
        {slackAppIntegrations.map((slackAppIntegration) => {
          const { tokenGtoP, tokenPtoG } = slackAppIntegration;
          return (
            <React.Fragment key={slackAppIntegration.id}>
              <div className="d-flex justify-content-end">
                <button
                  className="my-3 btn btn-outline-danger"
                  type="button"
                  onClick={() => setIsDeleteConfirmModalShown(true)}
                >
                  <i className="icon-trash mr-1" />
                  {t('admin:slack_integration.delete')}
                </button>
              </div>
              <WithProxyAccordions
                botType="officialBot"
                discardTokenHandler={() => discardTokenHandler(tokenGtoP, tokenPtoG)}
                generateTokenHandler={generateTokenHandler}
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
        isOpen={isDeleteConfirmModalShown}
        onClose={() => setIsDeleteConfirmModalShown(false)}
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
  proxyServerUri: PropTypes.string,
};

export default OfficialBotSettingsWrapper;
