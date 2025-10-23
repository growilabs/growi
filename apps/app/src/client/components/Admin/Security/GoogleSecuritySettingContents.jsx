import React, { useCallback, useEffect } from 'react';

import { pathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';
import { useForm } from 'react-hook-form';
import urljoin from 'url-join';

import AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';
import AdminGoogleSecurityContainer from '~/client/services/AdminGoogleSecurityContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { useSiteUrl } from '~/stores-universal/context';

import { withUnstatedContainers } from '../../UnstatedUtils';

const GoogleSecurityManagementContents = (props) => {
  const {
    t, adminGeneralSecurityContainer, adminGoogleSecurityContainer, siteUrl,
  } = props;

  const { isGoogleEnabled } = adminGeneralSecurityContainer.state;
  const { googleClientId, googleClientSecret, retrieveError } = adminGoogleSecurityContainer.state;
  const googleCallbackUrl = urljoin(pathUtils.removeTrailingSlash(siteUrl), '/passport/google/callback');

  const { register, handleSubmit, reset } = useForm();

  // Sync form with container state
  useEffect(() => {
    reset({
      googleClientId,
      googleClientSecret,
    });
  }, [reset, googleClientId, googleClientSecret]);

  const onClickSubmit = useCallback(async(data) => {
    try {
      await adminGoogleSecurityContainer.changeGoogleClientId(data.googleClientId ?? '');
      await adminGoogleSecurityContainer.changeGoogleClientSecret(data.googleClientSecret ?? '');
      await adminGoogleSecurityContainer.updateGoogleSetting();
      await adminGeneralSecurityContainer.retrieveSetupStratedies();
      toastSuccess(t('security_settings.OAuth.Google.updated_google'));
    }
    catch (err) {
      toastError(err);
    }
  }, [adminGoogleSecurityContainer, adminGeneralSecurityContainer, t]);

  return (
    <form onSubmit={handleSubmit(onClickSubmit)}>
      <React.Fragment>

        <h2 className="alert-anchor border-bottom">
          {t('security_settings.OAuth.Google.name')}
        </h2>

        {retrieveError != null && (
          <div className="alert alert-danger">
            <p>{t('Error occurred')} : {retrieveError}</p>
          </div>
        )}

        <div className="row my-4">
          <div className="col-6 offset-3">
            <div className="form-check form-switch form-check-success">
              <input
                id="isGoogleEnabled"
                className="form-check-input"
                type="checkbox"
                checked={adminGeneralSecurityContainer.state.isGoogleEnabled || false}
                onChange={() => { adminGeneralSecurityContainer.switchIsGoogleOAuthEnabled() }}
              />
              <label className="form-label form-check-label" htmlFor="isGoogleEnabled">
                {t('security_settings.OAuth.Google.enable_google')}
              </label>
            </div>
            {(!adminGeneralSecurityContainer.state.setupStrategies.includes('google') && isGoogleEnabled)
              && <div className="badge text-bg-warning">{t('security_settings.setup_is_not_yet_complete')}</div>}
          </div>
        </div>

        <div className="row mb-5">
          <label className="form-label col-12 col-md-3 text-start text-md-end py-2">{t('security_settings.callback_URL')}</label>
          <div className="col-12 col-md-6">
            <input
              className="form-control"
              type="text"
              value={googleCallbackUrl}
              readOnly
            />
            <p className="form-text text-muted small">{t('security_settings.desc_of_callback_URL', { AuthName: 'OAuth' })}</p>
            {(siteUrl == null || siteUrl === '') && (
              <div className="alert alert-danger">
                <span className="material-symbols-outlined">error</span>
                <span
                // eslint-disable-next-line max-len
                  dangerouslySetInnerHTML={{ __html: t('alert.siteUrl_is_not_set', { link: `<a href="/admin/app">${t('headers.app_settings', { ns: 'commons' })}<span class="material-symbols-outlined">login</span></a>`, ns: 'commons' }) }}
                />
              </div>
            )}
          </div>
        </div>


        {isGoogleEnabled && (
          <React.Fragment>

            <h3 className="border-bottom mb-4">{t('security_settings.configuration')}</h3>

            <div className="row mb-4">
              <label htmlFor="googleClientId" className="col-3 text-end py-2 form-label">{t('security_settings.clientID')}</label>
              <div className="col-6">
                <input
                  className="form-control"
                  type="text"
                  {...register('googleClientId')}
                />
                <p className="form-text text-muted">
                  <small dangerouslySetInnerHTML={{ __html: t('security_settings.Use env var if empty', { env: 'OAUTH_GOOGLE_CLIENT_ID' }) }} />
                </p>
              </div>
            </div>

            <div className="row mb-4">
              <label htmlFor="googleClientSecret" className="col-3 text-end py-2 form-label">{t('security_settings.client_secret')}</label>
              <div className="col-6">
                <input
                  className="form-control"
                  type="password"
                  {...register('googleClientSecret')}
                />
                <p className="form-text text-muted">
                  <small dangerouslySetInnerHTML={{ __html: t('security_settings.Use env var if empty', { env: 'OAUTH_GOOGLE_CLIENT_SECRET' }) }} />
                </p>
              </div>
            </div>

            <div className="row mb-3">
              <div className="offset-3 col-6">
                <div className="form-check form-check-success">
                  <input
                    id="bindByUserNameGoogle"
                    className="form-check-input"
                    type="checkbox"
                    checked={adminGoogleSecurityContainer.state.isSameEmailTreatedAsIdenticalUser || false}
                    onChange={() => { adminGoogleSecurityContainer.switchIsSameEmailTreatedAsIdenticalUser() }}
                  />
                  <label
                    className="form-check-label"
                    htmlFor="bindByUserNameGoogle"
                    dangerouslySetInnerHTML={{ __html: t('security_settings.Treat email matching as identical') }}
                  />
                </div>
                <p className="form-text text-muted">
                  <small dangerouslySetInnerHTML={{ __html: t('security_settings.Treat email matching as identical_warn') }} />
                </p>
              </div>
            </div>

            <div className="row mb-4">
              <div className="offset-3 col-5">
                <button type="submit" className="btn btn-primary" disabled={retrieveError != null}>
                  {t('Update')}
                </button>
              </div>
            </div>

          </React.Fragment>
        )}

        <hr />

        <div style={{ minHeight: '300px' }}>
          <h4>
            <span className="material-symbols-outlined" aria-hidden="true">help</span>
            <a href="#collapseHelpForGoogleOauth" data-bs-toggle="collapse"> {t('security_settings.OAuth.how_to.google')}</a>
          </h4>
          <div className="card custom-card bg-body-tertiary">
            <ol id="collapseHelpForGoogleOauth" className="collapse mb-0">
              {/* eslint-disable-next-line max-len */}
              <li dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.Google.register_1', { link: '<a href="https://console.cloud.google.com/apis/credentials" target=_blank>Google Cloud Platform API Manager</a>' }) }} />
              <li dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.Google.register_2') }} />
              <li dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.Google.register_3') }} />
              <li dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.Google.register_4', { url: googleCallbackUrl }) }} />
              <li dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.Google.register_5') }} />
            </ol>
          </div>
        </div>

      </React.Fragment>
    </form>
  );
};

GoogleSecurityManagementContents.propTypes = {
  t: PropTypes.func.isRequired, // i18next
  adminGeneralSecurityContainer: PropTypes.instanceOf(AdminGeneralSecurityContainer).isRequired,
  adminGoogleSecurityContainer: PropTypes.instanceOf(AdminGoogleSecurityContainer).isRequired,
  siteUrl: PropTypes.string,
};

const GoogleSecurityManagementContentsFc = (props) => {
  const { t } = useTranslation('admin');
  const { data: siteUrl } = useSiteUrl();
  return <GoogleSecurityManagementContents t={t} siteUrl={siteUrl} {...props} />;
};

const GoogleSecurityManagementContentsWrapper = withUnstatedContainers(GoogleSecurityManagementContentsFc, [
  AdminGeneralSecurityContainer,
  AdminGoogleSecurityContainer,
]);

export default GoogleSecurityManagementContentsWrapper;
