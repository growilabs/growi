import React, { useEffect, useCallback } from 'react';

import { pathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import { useForm } from 'react-hook-form';
import urljoin from 'url-join';


import AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';
import AdminOidcSecurityContainer from '~/client/services/AdminOidcSecurityContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { useSiteUrl } from '~/stores-universal/context';

import { withUnstatedContainers } from '../../UnstatedUtils';

type Props = {
  adminGeneralSecurityContainer: AdminGeneralSecurityContainer;
  adminOidcSecurityContainer: AdminOidcSecurityContainer;
};

const OidcSecurityManagementContents = (props: Props) => {
  const { t } = useTranslation('admin');
  const { data: siteUrl } = useSiteUrl();

  const {
    adminGeneralSecurityContainer, adminOidcSecurityContainer,
  } = props;
  const { isOidcEnabled } = adminGeneralSecurityContainer.state;
  const {
    oidcProviderName, oidcIssuerHost, oidcClientId, oidcClientSecret,
    oidcAuthorizationEndpoint, oidcTokenEndpoint, oidcRevocationEndpoint, oidcIntrospectionEndpoint,
    oidcUserInfoEndpoint, oidcEndSessionEndpoint, oidcRegistrationEndpoint, oidcJWKSUri,
    oidcAttrMapId, oidcAttrMapUserName, oidcAttrMapName, oidcAttrMapEmail,
  } = adminOidcSecurityContainer.state;

  const oidcCallbackUrl = urljoin(
    siteUrl == null ? '' : pathUtils.removeTrailingSlash(siteUrl),
    '/passport/oidc/callback',
  );

  const { register, handleSubmit, reset } = useForm();

  useEffect(() => {
    reset({
      oidcProviderName,
      oidcIssuerHost,
      oidcClientId,
      oidcClientSecret,
      oidcAuthorizationEndpoint,
      oidcTokenEndpoint,
      oidcRevocationEndpoint,
      oidcIntrospectionEndpoint,
      oidcUserInfoEndpoint,
      oidcEndSessionEndpoint,
      oidcRegistrationEndpoint,
      oidcJWKSUri,
      oidcAttrMapId,
      oidcAttrMapUserName,
      oidcAttrMapName,
      oidcAttrMapEmail,
    });
  }, [
    reset, oidcProviderName, oidcIssuerHost, oidcClientId, oidcClientSecret,
    oidcAuthorizationEndpoint, oidcTokenEndpoint, oidcRevocationEndpoint, oidcIntrospectionEndpoint,
    oidcUserInfoEndpoint, oidcEndSessionEndpoint, oidcRegistrationEndpoint, oidcJWKSUri,
    oidcAttrMapId, oidcAttrMapUserName, oidcAttrMapName, oidcAttrMapEmail,
  ]);

  const onSubmit = useCallback(async(data) => {
    try {
      await adminOidcSecurityContainer.updateOidcSetting({
        oidcProviderName: data.oidcProviderName,
        oidcIssuerHost: data.oidcIssuerHost,
        oidcClientId: data.oidcClientId,
        oidcClientSecret: data.oidcClientSecret,
        oidcAuthorizationEndpoint: data.oidcAuthorizationEndpoint,
        oidcTokenEndpoint: data.oidcTokenEndpoint,
        oidcRevocationEndpoint: data.oidcRevocationEndpoint,
        oidcIntrospectionEndpoint: data.oidcIntrospectionEndpoint,
        oidcUserInfoEndpoint: data.oidcUserInfoEndpoint,
        oidcEndSessionEndpoint: data.oidcEndSessionEndpoint,
        oidcRegistrationEndpoint: data.oidcRegistrationEndpoint,
        oidcJWKSUri: data.oidcJWKSUri,
        oidcAttrMapId: data.oidcAttrMapId,
        oidcAttrMapUserName: data.oidcAttrMapUserName,
        oidcAttrMapName: data.oidcAttrMapName,
        oidcAttrMapEmail: data.oidcAttrMapEmail,
        isSameUsernameTreatedAsIdenticalUser: adminOidcSecurityContainer.state.isSameUsernameTreatedAsIdenticalUser,
        isSameEmailTreatedAsIdenticalUser: adminOidcSecurityContainer.state.isSameEmailTreatedAsIdenticalUser,
      });
      await adminGeneralSecurityContainer.retrieveSetupStratedies();
      toastSuccess(t('security_settings.OAuth.OIDC.updated_oidc'));
    }
    catch (err) {
      toastError(err);
    }
  }, [t, adminOidcSecurityContainer, adminGeneralSecurityContainer]);

  return (
    <>
      <h2 className="alert-anchor border-bottom">
        {t('security_settings.OAuth.OIDC.name')}
      </h2>

      <div className="row  my-4">
        <div className="offset-3 col-6">
          <div className="form-check form-switch form-check-success">
            <input
              id="isOidcEnabled"
              className="form-check-input"
              type="checkbox"
              checked={adminGeneralSecurityContainer.state.isOidcEnabled}
              onChange={() => { adminGeneralSecurityContainer.switchIsOidcEnabled() }}
            />
            <label className="form-label form-check-label" htmlFor="isOidcEnabled">
              {t('security_settings.OAuth.enable_oidc')}
            </label>
          </div>
          {(!adminGeneralSecurityContainer.state.setupStrategies.includes('oidc') && isOidcEnabled)
              && <div className="badge text-bg-warning">{t('security_settings.setup_is_not_yet_complete')}</div>}
        </div>
      </div>

      <div className="row mb-5">
        <label className="text-start text-md-end col-md-3 col-form-label">{t('security_settings.callback_URL')}</label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            value={oidcCallbackUrl}
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

      {isOidcEnabled && (
        <form onSubmit={handleSubmit(onSubmit)}>

          <h3 className="border-bottom mb-4">{t('security_settings.configuration')}</h3>

          <div className="row mb-4">
            <label htmlFor="oidcProviderName" className="text-start text-md-end col-md-3 col-form-label">{t('security_settings.providerName')}</label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...register('oidcProviderName')}
              />
            </div>
          </div>

          <div className="row mb-4">
            <label htmlFor="oidcIssuerHost" className="text-start text-md-end col-md-3 col-form-label">{t('security_settings.issuerHost')}</label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...register('oidcIssuerHost')}
              />
              <p className="form-text text-muted">
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.Use env var if empty', { env: 'OAUTH_OIDC_ISSUER_HOST' }) }} />
              </p>
            </div>
          </div>

          <div className="row mb-4">
            <label htmlFor="oidcClientId" className="text-start text-md-end col-md-3 col-form-label">{t('security_settings.clientID')}</label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...register('oidcClientId')}
              />
              <p className="form-text text-muted">
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.Use env var if empty', { env: 'OAUTH_OIDC_CLIENT_ID' }) }} />
              </p>
            </div>
          </div>

          <div className="row mb-4">
            <label htmlFor="oidcClientSecret" className="text-start text-md-end col-md-3 col-form-label">{t('security_settings.client_secret')}</label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...register('oidcClientSecret')}
              />
              <p className="form-text text-muted">
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.Use env var if empty', { env: 'OAUTH_OIDC_CLIENT_SECRET' }) }} />
              </p>
            </div>
          </div>

          <div className="row mb-4">
            <label htmlFor="oidcAuthorizationEndpoint" className="text-start text-md-end col-md-3 col-form-label">
              {t('security_settings.authorization_endpoint')}
            </label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...register('oidcAuthorizationEndpoint')}
              />
              <p className="form-text text-muted">
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.OIDC.Use discovered URL if empty') }} />
              </p>
            </div>
          </div>

          <div className="row mb-4">
            <label htmlFor="oidcTokenEndpoint" className="text-start text-md-end col-md-3 col-form-label">{t('security_settings.token_endpoint')}</label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...register('oidcTokenEndpoint')}
              />
              <p className="form-text text-muted">
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.OIDC.Use discovered URL if empty') }} />
              </p>
            </div>
          </div>

          <div className="row mb-4">
            <label htmlFor="oidcRevocationEndpoint" className="text-start text-md-end col-md-3 col-form-label">
              {t('security_settings.revocation_endpoint')}
            </label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...register('oidcRevocationEndpoint')}
              />
              <p className="form-text text-muted">
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.OIDC.Use discovered URL if empty') }} />
              </p>
            </div>
          </div>

          <div className="row mb-4">
            <label htmlFor="oidcIntrospectionEndpoint" className="text-start text-md-end col-md-3 col-form-label">
              {t('security_settings.introspection_endpoint')}
            </label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...register('oidcIntrospectionEndpoint')}
              />
              <p className="form-text text-muted">
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.OIDC.Use discovered URL if empty') }} />
              </p>
            </div>
          </div>

          <div className="row mb-4">
            <label htmlFor="oidcUserInfoEndpoint" className="text-start text-md-end col-md-3 col-form-label">
              {t('security_settings.userinfo_endpoint')}
            </label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...register('oidcUserInfoEndpoint')}
              />
              <p className="form-text text-muted">
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.OIDC.Use discovered URL if empty') }} />
              </p>
            </div>
          </div>

          <div className="row mb-4">
            <label htmlFor="oidcEndSessionEndpoint" className="text-start text-md-end col-md-3 col-form-label">
              {t('security_settings.end_session_endpoint')}
            </label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...register('oidcEndSessionEndpoint')}
              />
              <p className="form-text text-muted">
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.OIDC.Use discovered URL if empty') }} />
              </p>
            </div>
          </div>

          <div className="row mb-4">
            <label htmlFor="oidcRegistrationEndpoint" className="text-start text-md-end col-md-3 col-form-label">
              {t('security_settings.registration_endpoint')}
            </label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...register('oidcRegistrationEndpoint')}
              />
              <p className="form-text text-muted">
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.OIDC.Use discovered URL if empty') }} />
              </p>
            </div>
          </div>

          <div className="row mb-4">
            <label htmlFor="oidcJWKSUri" className="text-start text-md-end col-md-3 col-form-label">{t('security_settings.jwks_uri')}</label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...register('oidcJWKSUri')}
              />
              <p className="form-text text-muted">
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.OIDC.Use discovered URL if empty') }} />
              </p>
            </div>
          </div>

          <h3 className="alert-anchor border-bottom mb-4">
            Attribute Mapping ({t('optional')})
          </h3>

          <div className="row mb-4">
            <label htmlFor="oidcAttrMapId" className="text-start text-md-end col-md-3 col-form-label">Identifier</label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...register('oidcAttrMapId')}
              />
              <p className="form-text text-muted">
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.OIDC.id_detail') }} />
              </p>
            </div>
          </div>

          <div className="row mb-4">
            <label htmlFor="oidcAttrMapUserName" className="text-start text-md-end col-md-3 col-form-label">{t('username')}</label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...register('oidcAttrMapUserName')}
              />
              <p className="form-text text-muted">
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.OIDC.username_detail') }} />
              </p>
            </div>
          </div>

          <div className="row mb-4">
            <label htmlFor="oidcAttrMapName" className="text-start text-md-end col-md-3 col-form-label">{t('Name')}</label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...register('oidcAttrMapName')}
              />
              <p className="form-text text-muted">
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.OIDC.name_detail') }} />
              </p>
            </div>
          </div>

          <div className="row mb-4">
            <label htmlFor="oidcAttrMapEmail" className="text-start text-md-end col-md-3 col-form-label">{t('Email')}</label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                {...register('oidcAttrMapEmail')}
              />
              <p className="form-text text-muted">
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.OIDC.mapping_detail', { target: t('Email') }) }} />
              </p>
            </div>
          </div>

          <div className="row mb-4">
            <label className="form-label text-start text-md-end col-md-3 col-form-label">{t('security_settings.callback_URL')}</label>
            <div className="col-md-6">
              <input
                className="form-control"
                type="text"
                defaultValue={oidcCallbackUrl}
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

          <div className="row mb-4">
            <div className="offset-md-3 col-md-6">
              <div className="form-check form-check-success">
                <input
                  id="bindByUserName-oidc"
                  className="form-check-input"
                  type="checkbox"
                  checked={adminOidcSecurityContainer.state.isSameUsernameTreatedAsIdenticalUser}
                  onChange={() => { adminOidcSecurityContainer.switchIsSameUsernameTreatedAsIdenticalUser() }}
                />
                <label
                  className="form-label form-check-label"
                  htmlFor="bindByUserName-oidc"
                  dangerouslySetInnerHTML={{ __html: t('security_settings.Treat username matching as identical') }}
                />
              </div>
              <p className="form-text text-muted">
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.Treat username matching as identical_warn') }} />
              </p>
            </div>
          </div>

          <div className="row mb-4">
            <div className="offset-md-3 col-md-6">
              <div className="form-check form-check-success">
                <input
                  id="bindByEmail-oidc"
                  className="form-check-input"
                  type="checkbox"
                  checked={adminOidcSecurityContainer.state.isSameEmailTreatedAsIdenticalUser || false}
                  onChange={() => { adminOidcSecurityContainer.switchIsSameEmailTreatedAsIdenticalUser() }}
                />
                <label
                  className="form-label form-check-label"
                  htmlFor="bindByEmail-oidc"
                  dangerouslySetInnerHTML={{ __html: t('security_settings.Treat email matching as identical') }}
                />
              </div>
              <p className="form-text text-muted">
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.Treat email matching as identical_warn') }} />
              </p>
            </div>
          </div>

          <div className="row my-3">
            <div className="offset-3 col-5">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={adminOidcSecurityContainer.state.retrieveError != null}
              >
                {t('Update')}
              </button>
            </div>
          </div>
        </form>
      )}


      <hr />

      <div style={{ minHeight: '300px' }}>
        <h4>
          <span className="material-symbols-outlined" aria-hidden="true">help</span>
          <a href="#collapseHelpForOidcOauth" data-bs-toggle="collapse"> {t('security_settings.OAuth.how_to.oidc')}</a>
        </h4>
        <div className=" card custom-card bg-body-tertiary">
          <ol id="collapseHelpForOidcOauth" className="collapse mb-0">
            <li>{t('security_settings.OAuth.OIDC.register_1')}</li>
            <li dangerouslySetInnerHTML={{ __html: t('security_settings.OAuth.OIDC.register_2', { url: oidcCallbackUrl }) }} />
            <li>{t('security_settings.OAuth.OIDC.register_3')}</li>
          </ol>
        </div>
      </div>

    </>
  );
};

const OidcSecurityManagementContentsWrapper = withUnstatedContainers(OidcSecurityManagementContents, [
  AdminGeneralSecurityContainer,
  AdminOidcSecurityContainer,
]);

export default OidcSecurityManagementContentsWrapper;
