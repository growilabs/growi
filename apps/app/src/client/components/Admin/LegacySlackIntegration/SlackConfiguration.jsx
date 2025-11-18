import React, { useCallback, useEffect } from 'react';

import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';
import { useForm } from 'react-hook-form';

import AdminSlackIntegrationLegacyContainer from '~/client/services/AdminSlackIntegrationLegacyContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';
import loggerFactory from '~/utils/logger';

import { withUnstatedContainers } from '../../UnstatedUtils';
import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

const logger = loggerFactory('growi:slackAppConfiguration');

const SlackConfiguration = (props) => {
  const { t, adminSlackIntegrationLegacyContainer } = props;
  const { webhookUrl, slackToken, retrieveError } = adminSlackIntegrationLegacyContainer.state;

  const { register, handleSubmit, reset } = useForm();

  // Sync form with container state
  useEffect(() => {
    reset({
      webhookUrl,
      slackToken,
    });
  }, [reset, webhookUrl, slackToken]);

  const onClickSubmit = useCallback(async(data) => {
    try {
      await adminSlackIntegrationLegacyContainer.changeWebhookUrl(data.webhookUrl ?? '');
      await adminSlackIntegrationLegacyContainer.changeSlackToken(data.slackToken ?? '');
      await adminSlackIntegrationLegacyContainer.updateSlackAppConfiguration();
      toastSuccess(t('notification_settings.updated_slackApp'));
    }
    catch (err) {
      toastError(err);
      logger.error(err);
    }
  }, [adminSlackIntegrationLegacyContainer, t]);

  return (
    <form onSubmit={handleSubmit(onClickSubmit)}>
      <React.Fragment>
        <div className="row my-3">
          <div className="col-6 text-start">
            <div className="dropdown">
              <button
                className="btn btn-secondary dropdown-toggle"
                type="button"
                id="dropdownMenuButton"
                data-bs-toggle="dropdown"
                aria-haspopup="true"
                aria-expanded="true"
              >
                {`Slack ${adminSlackIntegrationLegacyContainer.state.selectSlackOption}`}
              </button>
              <div className="dropdown-menu" aria-labelledby="dropdownMenuButton">
                <button className="dropdown-item" type="button" onClick={() => adminSlackIntegrationLegacyContainer.switchSlackOption('Incoming Webhooks')}>
                  Slack Incoming Webhooks
                </button>
                <button className="dropdown-item" type="button" onClick={() => adminSlackIntegrationLegacyContainer.switchSlackOption('App')}>Slack App</button>
              </div>
            </div>
          </div>
        </div>
        {adminSlackIntegrationLegacyContainer.state.selectSlackOption === 'Incoming Webhooks' ? (
          <React.Fragment>
            <h2 className="border-bottom mb-5">{t('notification_settings.slack_incoming_configuration')}</h2>

            <div className="row mb-3">
              <label className="form-label col-md-3 text-start text-md-end">Webhook URL</label>
              <div className="col-md-6">
                <input
                  className="form-control"
                  type="text"
                  {...register('webhookUrl')}
                />
              </div>
            </div>

            <div className="row mb-3">
              <div className="offset-md-3 col-md-6 text-start">
                <div className="form-check form-check-success">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    id="cbPrioritizeIWH"
                    checked={adminSlackIntegrationLegacyContainer.state.isIncomingWebhookPrioritized || false}
                    onChange={() => { adminSlackIntegrationLegacyContainer.switchIsIncomingWebhookPrioritized() }}
                  />
                  <label className="form-label form-check-label" htmlFor="cbPrioritizeIWH">
                    {t('notification_settings.prioritize_webhook')}
                  </label>
                </div>
                <p className="form-text text-muted">
                  {t('notification_settings.prioritize_webhook_desc')}
                </p>
              </div>
            </div>
          </React.Fragment>
        )
          : (
            <React.Fragment>
              <h2 className="border-bottom mb-3">{t('notification_settings.slack_app_configuration')}</h2>

              <div className="card custom-card bg-danger-subtle">
                <span className="text-danger"><span className="material-symbols-outlined">error</span>NOT RECOMMENDED</span>
                <br />
                {/* eslint-disable-next-line react/no-danger */}
                <span dangerouslySetInnerHTML={{ __html: t('notification_settings.slack_app_configuration_desc') }} />
                <br />
                <a
                  href="#slack-incoming-webhooks"
                  data-bs-toggle="tab"
                  onClick={() => adminSlackIntegrationLegacyContainer.switchSlackOption('Incoming Webhooks')}
                >
                  {t('notification_settings.use_instead')}
                </a>
              </div>

              <div className="row mb-5 mt-4">
                <label className="form-label col-md-3 text-start text-md-end">OAuth access token</label>
                <div className="col-md-6">
                  <input
                    className="form-control"
                    type="text"
                    {...register('slackToken')}
                  />
                </div>
              </div>

            </React.Fragment>
          )
        }

        <AdminUpdateButtonRow
          disabled={retrieveError != null}
          onClick={handleSubmit(onClickSubmit)}
        />

        <hr />

        <h3>
          <span className="material-symbols-outlined" aria-hidden="true">help</span>{' '}
          <a href="#collapseHelpForIwh" data-bs-toggle="collapse">{t('notification_settings.how_to.header')}</a>
        </h3>

        <ol id="collapseHelpForIwh" className="collapse card custom-card bg-body-tertiary">
          <li className="ms-3">
            {t('notification_settings.how_to.workspace')}
            <ol>
              {/* eslint-disable-next-line react/no-danger */}
              <li dangerouslySetInnerHTML={{ __html: t('notification_settings.how_to.workspace_desc1') }} />
              <li>{t('notification_settings.how_to.workspace_desc2')}</li>
              <li>{t('notification_settings.how_to.workspace_desc3')}</li>
            </ol>
          </li>
          <li className="ms-3">
            {t('notification_settings.how_to.at_growi')}
            <ol>
              {/* eslint-disable-next-line react/no-danger */}
              <li dangerouslySetInnerHTML={{ __html: t('notification_settings.how_to.at_growi_desc') }} />
            </ol>
          </li>
        </ol>

      </React.Fragment>
    </form>
  );
};

SlackConfiguration.propTypes = {
  t: PropTypes.func.isRequired, // i18next
  adminSlackIntegrationLegacyContainer: PropTypes.instanceOf(AdminSlackIntegrationLegacyContainer).isRequired,
};

const SlackConfigurationWrapperFc = (props) => {
  const { t } = useTranslation('admin');

  return <SlackConfiguration t={t} {...props} />;
};

const SlackConfigurationWrapper = withUnstatedContainers(SlackConfigurationWrapperFc, [AdminSlackIntegrationLegacyContainer]);

export default SlackConfigurationWrapper;
