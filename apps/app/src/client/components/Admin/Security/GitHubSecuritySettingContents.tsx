/* eslint-disable react/no-danger */
import React, { useCallback, useEffect } from 'react';

import { pathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import { useForm } from 'react-hook-form';
import urljoin from 'url-join';


import AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';
import AdminGitHubSecurityContainer from '~/client/services/AdminGitHubSecurityContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { useSiteUrlWithEmptyValueWarn } from '~/states/global';

import { withUnstatedContainers } from '../../UnstatedUtils';

type Props = {
  adminGeneralSecurityContainer: AdminGeneralSecurityContainer
  adminGitHubSecurityContainer: AdminGitHubSecurityContainer
};

const GitHubSecurityManagementContents = (props: Props) => {
  const {
    adminGeneralSecurityContainer, adminGitHubSecurityContainer,
  } = props;

  const { t } = useTranslation('admin');
  const siteUrl = useSiteUrlWithEmptyValueWarn();

  const { isGitHubEnabled } = adminGeneralSecurityContainer.state;
  const { githubClientId, githubClientSecret, retrieveError } = adminGitHubSecurityContainer.state;
  const gitHubCallbackUrl = urljoin(pathUtils.removeTrailingSlash(siteUrl), '/passport/github/callback');

  const { register, handleSubmit, reset } = useForm();

  // Sync form with container state
  useEffect(() => {
    reset({
      githubClientId,
      githubClientSecret,
    });
  }, [reset, githubClientId, githubClientSecret]);

  const onClickSubmit = useCallback(async(data) => {
    try {
      await adminGitHubSecurityContainer.changeGitHubClientId(data.githubClientId ?? '');
      await adminGitHubSecurityContainer.changeGitHubClientSecret(data.githubClientSecret ?? '');
      await adminGitHubSecurityContainer.updateGitHubSetting();
      await adminGeneralSecurityContainer.retrieveSetupStratedies();
      toastSuccess(t('security_settings.OAuth.GitHub.updated_github'));
    }
    catch (err) {
      toastError(err);
    }
  }, [adminGitHubSecurityContainer, adminGeneralSecurityContainer, t]);

  return (
    <form onSubmit={handleSubmit(onClickSubmit)}>
      <React.Fragment>

        <h2 className="alert-anchor border-bottom">
          {t('security_settings.OAuth.GitHub.name')}
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
                id="isGitHubEnabled"
                className="form-check-input"
                type="checkbox"
                checked={adminGeneralSecurityContainer.state.isGitHubEnabled || false}
                onChange={() => { adminGeneralSecurityContainer.switchIsGitHubOAuthEnabled() }}
              />
              <label className="form-label form-check-label" htmlFor="isGitHubEnabled">
                {t('security_settings.OAuth.GitHub.enable_github')}
              </label>
            </div>
            {(!adminGeneralSecurityContainer.state.setupStrategies.includes('github') && isGitHubEnabled)
              && <div className="badge text-bg-warning">{t('security_settings.setup_is_not_yet_complete')}</div>}
          </div>
        </div>

        <div className="row mb-4">
          <label className="form-label col-12 col-md-3 text-start text-md-end py-2">{t('security_settings.callback_URL')}</label>
          <div className="col-12 col-md-6">
            <input
              className="form-control"
              type="text"
              value={gitHubCallbackUrl}
              readOnly
            />
            <p className="form-text text-muted small">{t('security_settings.desc_of_callback_URL', { AuthName: 'OAuth' })}</p>
            {(siteUrl == null || siteUrl === '') && (
              <div className="alert alert-danger">
                <span className="material-symbols-outlined">error</span>
                <span // eslint-disable-next-line max-len
                  dangerouslySetInnerHTML={{ __html: t('alert.siteUrl_is_not_set', { link: `<a href="/admin/app">${t('headers.app_settings', { ns: 'commons' })}<span class="material-symbols-outlined">login</span></a>`, ns: 'commons' }) }}
                />
              </div>
            )}
          </div>
        </div>


        {isGitHubEnabled && (
          <React.Fragment>

            <h3 className="border-bottom mb-4">{t('security_settings.configuration')}</h3>

            <div className="row mb-4">
              <label htmlFor="githubClientId" className="col-3 text-end py-2 form-label">{t('security_settings.clientID')}</label>
              <div className="col-6">
                <input
                  className="form-control"
                  type="text"
                  {...register('githubClientId')}
                />
                <p className="form-text text-muted">
                  <small dangerouslySetInnerHTML={{ __html: t('security_settings.Use env var if empty', { env: 'OAUTH_GITHUB_CLIENT_ID' }) }} />
                </p>
              </div>
            </div>

            <div className="row mb-3">
              <label htmlFor="githubClientSecret" className="col-3 text-end py-2 form-label">{t('security_settings.client_secret')}</label>
              <div className="col-6">
                <input
                  className="form-control"
                  type="text"
                  {...register('githubClientSecret')}
                />
                <p className="form-text text-muted">
                  <small dangerouslySetInnerHTML={{ __html: t('security_settings.Use env var if empty', { env: 'OAUTH_GITHUB_CLIENT_SECRET' }) }} />
                </p>
              </div>
            </div>

            <div className="row mb-3">
              <div className="offset-3 col-6 text-start">
                <div className="form-check form-check-success">
                  <input
                    id="bindByUserNameGitHub"
                    className="form-check-input"
                    type="checkbox"
                    checked={adminGitHubSecurityContainer.state.isSameUsernameTreatedAsIdenticalUser || false}
                    onChange={() => { adminGitHubSecurityContainer.switchIsSameUsernameTreatedAsIdenticalUser() }}
                  />
                  <label
                    className="form-check-label"
                    htmlFor="bindByUserNameGitHub"
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
            <a href="#collapseHelpForGitHubOauth" data-bs-toggle="collapse"> {t('security_settings.OAuth.how_to.github')}</a>
          </h4>
          <div className="card custom-card bg-body-tertiary">
            <ol id="collapseHelpForGitHubOauth" className="collapse mb-0">
              {/* eslint-disable-next-line max-len */}
              <li dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.GitHub.register_1', { link: '<a href="https://github.com/settings/developers" target=_blank>GitHub Developer Settings</a>' }) }} />
              <li dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.GitHub.register_2', { url: gitHubCallbackUrl }) }} />
              <li dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.GitHub.register_3') }} />
            </ol>
          </div>
        </div>

      </React.Fragment>
    </form>
  );
};

/**
 * Wrapper component for using unstated
 */
const GitHubSecurityManagementContentsWrapper = withUnstatedContainers(GitHubSecurityManagementContents, [
  AdminGeneralSecurityContainer,
  AdminGitHubSecurityContainer,
]);

export default GitHubSecurityManagementContentsWrapper;
