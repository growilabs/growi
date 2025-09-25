import React from 'react';

import { pathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';
import urljoin from 'url-join';


import AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';
import AdminOidcSecurityContainer from '~/client/services/AdminOidcSecurityContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { useSiteUrl } from '~/stores-universal/context';

import { withUnstatedContainers } from '../../UnstatedUtils';

class OidcSecurityManagementContents extends React.Component {

  constructor(props) {
    super(props);

    this.onClickSubmit = this.onClickSubmit.bind(this);
  }

  async onClickSubmit() {
    const { t, adminOidcSecurityContainer, adminGeneralSecurityContainer } = this.props;

    try {
      await adminOidcSecurityContainer.updateOidcSetting();
      await adminGeneralSecurityContainer.retrieveSetupStratedies();
      toastSuccess(t('security_settings.OAuth.OIDC.updated_oidc'));
    }
    catch (err) {
      toastError(err);
    }
  }

  render() {
    const {
      t, adminGeneralSecurityContainer, adminOidcSecurityContainer, siteUrl,
    } = this.props;
    const { isOidcEnabled } = adminGeneralSecurityContainer.state;
    const oidcCallbackUrl = urljoin(pathUtils.removeTrailingSlash(siteUrl), '/passport/oidc/callback');

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
          <>

            <h3 className="border-bottom mb-4">{t('security_settings.configuration')}</h3>

            <div className="row mb-4">
              <label htmlFor="oidcProviderName" className="text-start text-md-end col-md-3 col-form-label">{t('security_settings.providerName')}</label>
              <div className="col-md-6">
                <input
                  className="form-control"
                  type="text"
                  name="oidcProviderName"
                  value={adminOidcSecurityContainer.state.oidcProviderName || ''}
                  onChange={e => adminOidcSecurityContainer.changeOidcProviderName(e.target.value)}
                />
              </div>
            </div>

            <div className="row mb-4">
              <label htmlFor="oidcIssuerHost" className="text-start text-md-end col-md-3 col-form-label">{t('security_settings.issuerHost')}</label>
              <div className="col-md-6">
                <input
                  className="form-control"
                  type="text"
                  name="oidcIssuerHost"
                  value={adminOidcSecurityContainer.state.oidcIssuerHost || ''}
                  onChange={e => adminOidcSecurityContainer.changeOidcIssuerHost(e.target.value)}
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
                  name="oidcClientId"
                  value={adminOidcSecurityContainer.state.oidcClientId || ''}
                  onChange={e => adminOidcSecurityContainer.changeOidcClientId(e.target.value)}
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
                  name="oidcClientSecret"
                  value={adminOidcSecurityContainer.state.oidcClientSecret || ''}
                  onChange={e => adminOidcSecurityContainer.changeOidcClientSecret(e.target.value)}
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
                  name="oidcAuthorizationEndpoint"
                  value={adminOidcSecurityContainer.state.oidcAuthorizationEndpoint || ''}
                  onChange={e => adminOidcSecurityContainer.changeOidcAuthorizationEndpoint(e.target.value)}
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
                  name="oidcTokenEndpoint"
                  value={adminOidcSecurityContainer.state.oidcTokenEndpoint || ''}
                  onChange={e => adminOidcSecurityContainer.changeOidcTokenEndpoint(e.target.value)}
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
                  name="oidcRevocationEndpoint"
                  value={adminOidcSecurityContainer.state.oidcRevocationEndpoint || ''}
                  onChange={e => adminOidcSecurityContainer.changeOidcRevocationEndpoint(e.target.value)}
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
                  name="oidcIntrospectionEndpoint"
                  value={adminOidcSecurityContainer.state.oidcIntrospectionEndpoint || ''}
                  onChange={e => adminOidcSecurityContainer.changeOidcIntrospectionEndpoint(e.target.value)}
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
                  name="oidcUserInfoEndpoint"
                  value={adminOidcSecurityContainer.state.oidcUserInfoEndpoint || ''}
                  onChange={e => adminOidcSecurityContainer.changeOidcUserInfoEndpoint(e.target.value)}
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
                  name="oidcEndSessionEndpoint"
                  value={adminOidcSecurityContainer.state.oidcEndSessionEndpoint || ''}
                  onChange={e => adminOidcSecurityContainer.changeOidcEndSessionEndpoint(e.target.value)}
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
                  name="oidcRegistrationEndpoint"
                  value={adminOidcSecurityContainer.state.oidcRegistrationEndpoint || ''}
                  onChange={e => adminOidcSecurityContainer.changeOidcRegistrationEndpoint(e.target.value)}
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
                  name="oidcJWKSUri"
                  value={adminOidcSecurityContainer.state.oidcJWKSUri || ''}
                  onChange={e => adminOidcSecurityContainer.changeOidcJWKSUri(e.target.value)}
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
                  name="oidcAttrMapId"
                  value={adminOidcSecurityContainer.state.oidcAttrMapId || ''}
                  onChange={e => adminOidcSecurityContainer.changeOidcAttrMapId(e.target.value)}
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
                  name="oidcAttrMapUserName"
                  value={adminOidcSecurityContainer.state.oidcAttrMapUserName || ''}
                  onChange={e => adminOidcSecurityContainer.changeOidcAttrMapUserName(e.target.value)}
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
                  name="oidcAttrMapName"
                  value={adminOidcSecurityContainer.state.oidcAttrMapName || ''}
                  onChange={e => adminOidcSecurityContainer.changeOidcAttrMapName(e.target.value)}
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
                  name="oidcAttrMapEmail"
                  value={adminOidcSecurityContainer.state.oidcAttrMapEmail || ''}
                  onChange={e => adminOidcSecurityContainer.changeOidcAttrMapEmail(e.target.value)}
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
                  type="button"
                  className="btn btn-primary"
                  disabled={adminOidcSecurityContainer.state.retrieveError != null}
                  onClick={this.onClickSubmit}
                >
                  {t('Update')}
                </button>
              </div>
            </div>
          </>
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
  }

}

OidcSecurityManagementContents.propTypes = {
  t: PropTypes.func.isRequired, // i18next
  adminGeneralSecurityContainer: PropTypes.instanceOf(AdminGeneralSecurityContainer).isRequired,
  adminOidcSecurityContainer: PropTypes.instanceOf(AdminOidcSecurityContainer).isRequired,
  siteUrl: PropTypes.string,
};

const OidcSecurityManagementContentsWrapperFC = (props) => {
  const { t } = useTranslation('admin');
  const { data: siteUrl } = useSiteUrl();
  return <OidcSecurityManagementContents t={t} {...props} siteUrl={siteUrl} />;
};

const OidcSecurityManagementContentsWrapper = withUnstatedContainers(OidcSecurityManagementContentsWrapperFC, [
  AdminGeneralSecurityContainer,
  AdminOidcSecurityContainer,
]);

export default OidcSecurityManagementContentsWrapper;
