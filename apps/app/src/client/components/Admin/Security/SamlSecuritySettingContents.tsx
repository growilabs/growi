/* eslint-disable react/no-danger */
import React, { useState, useEffect, useCallback } from 'react';

import { pathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import { useForm } from 'react-hook-form';
import { Collapse } from 'reactstrap';
import urljoin from 'url-join';


import AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';
import AdminSamlSecurityContainer from '~/client/services/AdminSamlSecurityContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { useSiteUrlWithEmptyValueWarn } from '~/states/global';

import { withUnstatedContainers } from '../../UnstatedUtils';

type Props = {
  adminGeneralSecurityContainer: AdminGeneralSecurityContainer;
  adminSamlSecurityContainer: AdminSamlSecurityContainer;
};

const SamlSecurityManagementContents = (props: Props) => {
  const {
    adminGeneralSecurityContainer, adminSamlSecurityContainer,
  } = props;

  const { t } = useTranslation('admin');
  const siteUrl = useSiteUrlWithEmptyValueWarn();

  const [isHelpOpened, setIsHelpOpened] = useState(false);
  const { register, handleSubmit, reset } = useForm();

  useEffect(() => {
    reset({
      samlEntryPoint: adminSamlSecurityContainer.state.samlEntryPoint || '',
      samlIssuer: adminSamlSecurityContainer.state.samlIssuer || '',
      samlCert: adminSamlSecurityContainer.state.samlCert || '',
      samlAttrMapId: adminSamlSecurityContainer.state.samlAttrMapId || '',
      samlAttrMapUsername: adminSamlSecurityContainer.state.samlAttrMapUsername || '',
      samlAttrMapMail: adminSamlSecurityContainer.state.samlAttrMapMail || '',
      samlAttrMapFirstName: adminSamlSecurityContainer.state.samlAttrMapFirstName || '',
      samlAttrMapLastName: adminSamlSecurityContainer.state.samlAttrMapLastName || '',
      samlABLCRule: adminSamlSecurityContainer.state.samlABLCRule || '',
    });
  }, [adminSamlSecurityContainer.state, reset]);

  const onSubmit = useCallback(async(data) => {
    try {
      await adminSamlSecurityContainer.updateSamlSetting({
        samlEntryPoint: data.samlEntryPoint,
        samlIssuer: data.samlIssuer,
        samlCert: data.samlCert,
        samlAttrMapId: data.samlAttrMapId,
        samlAttrMapUsername: data.samlAttrMapUsername,
        samlAttrMapMail: data.samlAttrMapMail,
        samlAttrMapFirstName: data.samlAttrMapFirstName,
        samlAttrMapLastName: data.samlAttrMapLastName,
        isSameUsernameTreatedAsIdenticalUser: adminSamlSecurityContainer.state.isSameUsernameTreatedAsIdenticalUser,
        isSameEmailTreatedAsIdenticalUser: adminSamlSecurityContainer.state.isSameEmailTreatedAsIdenticalUser,
        samlABLCRule: data.samlABLCRule,
      });
      toastSuccess(t('security_settings.SAML.updated_saml'));
    }
    catch (err) {
      toastError(err);
    }

    try {
      await adminGeneralSecurityContainer.retrieveSetupStratedies();
    }
    catch (err) {
      toastError(err);
    }
  }, [adminSamlSecurityContainer, adminGeneralSecurityContainer, t]);

  const { useOnlyEnvVars } = adminSamlSecurityContainer.state;
  const { isSamlEnabled } = adminGeneralSecurityContainer.state;

  const samlCallbackUrl = urljoin(pathUtils.removeTrailingSlash(siteUrl), '/passport/saml/callback');

  return (
    <React.Fragment>

      <h2 className="alert-anchor border-bottom">
        {t('security_settings.SAML.name')}
      </h2>

      {useOnlyEnvVars && (
        <p
          className="alert alert-info"
          dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.note for the only env option', { env: 'SAML_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS' }) }}
        />
      )}

      <div className="row mt-4 mb-5">
        <div className="col-6 offset-3">
          <div className="form-check form-switch form-check-success">
            <input
              id="isSamlEnabled"
              className="form-check-input"
              type="checkbox"
              checked={adminGeneralSecurityContainer.state.isSamlEnabled}
              onChange={() => { adminGeneralSecurityContainer.switchIsSamlEnabled() }}
              disabled={adminSamlSecurityContainer.state.useOnlyEnvVars}
            />
            <label className="form-label form-check-label" htmlFor="isSamlEnabled">
              {t('security_settings.SAML.enable_saml')}
            </label>
          </div>
          {(!adminGeneralSecurityContainer.state.setupStrategies.includes('saml') && isSamlEnabled)
              && <div className="badge text-bg-warning">{t('security_settings.setup_is_not_yet_complete')}</div>}
        </div>
      </div>

      <div className="row mb-5">
        <label className="text-start text-md-end col-md-3 col-form-label">{t('security_settings.callback_URL')}</label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            defaultValue={samlCallbackUrl}
            readOnly
          />
          <p className="form-text text-muted small">{t('security_settings.desc_of_callback_URL', { AuthName: 'SAML Identity' })}</p>
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

      {isSamlEnabled && (
        <form onSubmit={handleSubmit(onSubmit)}>

          {(adminSamlSecurityContainer.state.missingMandatoryConfigKeys.length !== 0) && (
            <div className="alert alert-danger">
              {t('security_settings.missing mandatory configs')}
              <ul className="mb-0">
                {adminSamlSecurityContainer.state.missingMandatoryConfigKeys.map((configKey) => {
                  const key = configKey.replace('security:passport-saml:', '');
                  return <li key={configKey}>{t(`security_settings.form_item_name.${key}`)}</li>;
                })}
              </ul>
            </div>
          )}


          <h3 className="alert-anchor border-bottom mb-3">
            Basic Settings
          </h3>

          <table className={`table settings-table ${useOnlyEnvVars && 'use-only-env-vars'}`}>
            <colgroup>
              <col className="item-name" />
              <col className="from-db" />
              <col className="from-env-vars" />
            </colgroup>
            <thead>
              <tr><th></th><th>Database</th><th>Environment variables</th></tr>
            </thead>
            <tbody>
              <tr>
                <th>{t('security_settings.form_item_name.entryPoint')}</th>
                <td>
                  <input
                    className="form-control"
                    type="text"
                    readOnly={useOnlyEnvVars}
                    {...register('samlEntryPoint')}
                  />
                </td>
                <td>
                  <input
                    className="form-control"
                    type="text"
                    value={adminSamlSecurityContainer.state.envEntryPoint || ''}
                    readOnly
                  />
                  <p className="form-text text-muted">
                    <small dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.Use env var if empty', { env: 'SAML_ENTRY_POINT' }) }} />
                  </p>
                </td>
              </tr>
              <tr>
                <th>{t('security_settings.form_item_name.issuer')}</th>
                <td>
                  <input
                    className="form-control"
                    type="text"
                    readOnly={useOnlyEnvVars}
                    {...register('samlIssuer')}
                  />
                </td>
                <td>
                  <input
                    className="form-control"
                    type="text"
                    value={adminSamlSecurityContainer.state.envIssuer || ''}
                    readOnly
                  />
                  <p className="form-text text-muted">
                    <small dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.Use env var if empty', { env: 'SAML_ISSUER' }) }} />
                  </p>
                </td>
              </tr>
              <tr>
                <th>{t('security_settings.form_item_name.cert')}</th>
                <td>
                  <textarea
                    className="form-control form-control-sm"
                    rows={5}
                    readOnly={useOnlyEnvVars}
                    {...register('samlCert')}
                  />
                  <p>
                    <small>
                      {t('security_settings.SAML.cert_detail')}
                    </small>
                  </p>
                  <div>
                    <small>
                      e.g.
                      <pre className="card custom-card">{`-----BEGIN CERTIFICATE-----
MIICBzCCAXACCQD4US7+0A/b/zANBgkqhkiG9w0BAQsFADBIMQswCQYDVQQGEwJK
UDEOMAwGA1UECAwFVG9reW8xFTATBgNVBAoMDFdFU0VFSywgSW5jLjESMBAGA1UE
...
crmVwBzbloUO2l6k1ibwD2WVwpdxMKIF5z58HfKAvxZAzCHE7kMEZr1ge30WRXQA
pWVdnzS1VCO8fKsJ7YYIr+JmHvseph3kFUOI5RqkCcMZlKUv83aUThsTHw==
-----END CERTIFICATE-----
                        `}
                      </pre>
                    </small>
                  </div>
                </td>
                <td>
                  <textarea
                    className="form-control form-control-sm"
                    rows={5}
                    readOnly
                    value={adminSamlSecurityContainer.state.envCert || ''}
                  />
                  <p className="form-text text-muted">
                    <small dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.Use env var if empty', { env: 'SAML_CERT' }) }} />
                  </p>
                </td>
              </tr>
            </tbody>
          </table>

          <h3 className="alert-anchor border-bottom mt-5 mb-3">
            Attribute Mapping
          </h3>

          <table className="table settings-table">
            <colgroup>
              <col className="item-name" />
              <col className="from-db" />
              <col className="from-env-vars" />
            </colgroup>
            <thead>
              <tr><th></th><th>Database</th><th>Environment variables</th></tr>
            </thead>
            <tbody>
              <tr>
                <th>{t('security_settings.form_item_name.attrMapId')}</th>
                <td>
                  <input
                    className="form-control"
                    type="text"
                    {...register('samlAttrMapId')}
                  />
                  <p className="form-text text-muted">
                    <small>
                      {t('security_settings.SAML.id_detail')}
                    </small>
                  </p>
                </td>
                <td>
                  <input
                    className="form-control"
                    type="text"
                    value={adminSamlSecurityContainer.state.envAttrMapId || ''}
                    readOnly
                  />
                  <p className="form-text text-muted">
                    <small dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.Use env var if empty', { env: 'SAML_ATTR_MAPPING_ID' }) }} />
                  </p>
                </td>
              </tr>
              <tr>
                <th>{t('security_settings.form_item_name.attrMapUsername')}</th>
                <td>
                  <input
                    className="form-control"
                    type="text"
                    {...register('samlAttrMapUsername')}
                  />
                  <p className="form-text text-muted">
                    <small dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.username_detail') }} />
                  </p>
                </td>
                <td>
                  <input
                    className="form-control"
                    type="text"
                    value={adminSamlSecurityContainer.state.envAttrMapUsername || ''}
                    readOnly
                  />
                  <p className="form-text text-muted">
                    <small dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.Use env var if empty', { env: 'SAML_ATTR_MAPPING_USERNAME' }) }} />
                  </p>
                </td>
              </tr>
              <tr>
                <th>{t('security_settings.form_item_name.attrMapMail')}</th>
                <td>
                  <input
                    className="form-control"
                    type="text"
                    {...register('samlAttrMapMail')}
                  />
                  <p className="form-text text-muted">
                    <small dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.mapping_detail', { target: 'Email' }) }} />
                  </p>
                </td>
                <td>
                  <input
                    className="form-control"
                    type="text"
                    value={adminSamlSecurityContainer.state.envAttrMapMail || ''}
                    readOnly
                  />
                  <p className="form-text text-muted">
                    <small dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.Use env var if empty', { env: 'SAML_ATTR_MAPPING_MAIL' }) }} />
                  </p>
                </td>
              </tr>
              <tr>
                <th>{t('security_settings.form_item_name.attrMapFirstName')}</th>
                <td>
                  <input
                    className="form-control"
                    type="text"
                    {...register('samlAttrMapFirstName')}
                  />
                  <p className="form-text text-muted">
                    {/* eslint-disable-next-line max-len */}
                    <small dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.mapping_detail', { target: t('security_settings.form_item_name.attrMapFirstName') }) }} />
                  </p>
                </td>
                <td>
                  <input
                    className="form-control"
                    type="text"
                    value={adminSamlSecurityContainer.state.envAttrMapFirstName || ''}
                    readOnly
                  />
                  <p className="form-text text-muted">
                    <small>
                      <span dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.Use env var if empty', { env: 'SAML_ATTR_MAPPING_FIRST_NAME' }) }} />
                      <br />
                      <span dangerouslySetInnerHTML={{ __html: t('security_settings.Use default if both are empty', { target: 'firstName' }) }} />
                    </small>
                  </p>
                </td>
              </tr>
              <tr>
                <th>{t('security_settings.form_item_name.attrMapLastName')}</th>
                <td>
                  <input
                    className="form-control"
                    type="text"
                    {...register('samlAttrMapLastName')}
                  />
                  <p className="form-text text-muted">
                    {/* eslint-disable-next-line max-len */}
                    <small dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.mapping_detail', { target: t('security_settings.form_item_name.attrMapLastName') }) }} />
                  </p>
                </td>
                <td>
                  <input
                    className="form-control"
                    type="text"
                    value={adminSamlSecurityContainer.state.envAttrMapLastName || ''}
                    readOnly
                  />
                  <p className="form-text text-muted">
                    <small>
                      <span dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.Use env var if empty', { env: 'SAML_ATTR_MAPPING_LAST_NAME' }) }} />
                      <br />
                      <span dangerouslySetInnerHTML={{ __html: t('security_settings.Use default if both are empty', { target: 'lastName' }) }} />
                    </small>
                  </p>
                </td>
              </tr>
            </tbody>
          </table>

          <h3 className="alert-anchor border-bottom mt-5 mb-4">
            Attribute Mapping Options
          </h3>

          <div className="row ms-3">
            <div className="form-check form-check-success">
              <input
                id="bindByUserName-SAML"
                className="form-check-input"
                type="checkbox"
                checked={adminSamlSecurityContainer.state.isSameUsernameTreatedAsIdenticalUser || false}
                onChange={() => { adminSamlSecurityContainer.switchIsSameUsernameTreatedAsIdenticalUser() }}
              />
              <label
                className="form-label form-check-label"
                htmlFor="bindByUserName-SAML"
                dangerouslySetInnerHTML={{ __html: t('security_settings.Treat username matching as identical') }}
              />
            </div>
            <p className="form-text text-muted">
              <small dangerouslySetInnerHTML={{ __html: t('security_settings.Treat username matching as identical_warn') }} />
            </p>
          </div>

          <div className="row mb-5 ms-3">
            <div className="form-check form-check-success">
              <input
                id="bindByEmail-SAML"
                className="form-check-input"
                type="checkbox"
                checked={adminSamlSecurityContainer.state.isSameEmailTreatedAsIdenticalUser || false}
                onChange={() => { adminSamlSecurityContainer.switchIsSameEmailTreatedAsIdenticalUser() }}
              />
              <label
                className="form-label form-check-label"
                htmlFor="bindByEmail-SAML"
                dangerouslySetInnerHTML={{ __html: t('security_settings.Treat email matching as identical') }}
              />
            </div>
            <p className="form-text text-muted">
              <small dangerouslySetInnerHTML={{ __html: t('security_settings.Treat email matching as identical_warn') }} />
            </p>
          </div>

          <h3 className="alert-anchor border-bottom mb-4">
            Attribute-based Login Control
          </h3>

          <p className="form-text text-muted">
            <small dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.attr_based_login_control_detail') }} />
          </p>

          <table className="table settings-table">
            <colgroup>
              <col className="item-name" />
              <col className="from-db" />
              <col className="from-env-vars" />
            </colgroup>
            <thead>
              <tr><th></th><th>Database</th><th>Environment variables</th></tr>
            </thead>
            <tbody>
              <tr>
                <th>
                  { t('security_settings.form_item_name.ABLCRule') }
                </th>
                <td>
                  <textarea
                    className="form-control"
                    {...register('samlABLCRule')}
                  />
                  <div className="mt-2">
                    <p>
                      See&nbsp;
                      <a
                        href="https://lucene.apache.org/core/2_9_4/queryparsersyntax.html"
                        target="_blank"
                        rel="noreferer noreferrer"
                      >
                        Apache Lucene - Query Parser Syntax <span className="growi-custom-icons">external_link</span>
                      </a>.
                    </p>
                    <div className="accordion" id="accordionId">
                      <div className="accordion-item p-1">
                        <h2 className="accordion-header">
                          <button
                            className="btn btn-link text-start"
                            type="button"
                            onClick={() => setIsHelpOpened(!isHelpOpened)}
                            aria-expanded="true"
                            aria-controls="ablchelp"
                          >
                            <span className="material-symbols-outlined me-1">
                              {isHelpOpened ? 'expand_more' : 'chevron_right'}
                            </span> Show more...
                          </button>
                        </h2>
                        <Collapse isOpen={isHelpOpened}>
                          <div className="accordion-body">
                            <p dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.attr_based_login_control_rule_help') }} />
                            <p dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.attr_based_login_control_rule_example1') }} />
                            <p dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.attr_based_login_control_rule_example2') }} />
                          </div>
                        </Collapse>
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <textarea
                    className="form-control"
                    value={adminSamlSecurityContainer.state.envABLCRule || ''}
                    readOnly
                  />
                  <p className="form-text text-muted">
                    <small dangerouslySetInnerHTML={{ __html: t('security_settings.SAML.Use env var if empty', { env: 'SAML_ABLC_RULE' }) }} />
                  </p>
                </td>
              </tr>
            </tbody>
          </table>

          <div className="row my-3">
            <div className="offset-3 col-5">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={adminSamlSecurityContainer.state.retrieveError != null}
              >
                {t('Update')}
              </button>
            </div>
          </div>

        </form>
      )}

    </React.Fragment>
  );
};

const SamlSecurityManagementContentsWrapper = withUnstatedContainers(SamlSecurityManagementContents, [
  AdminGeneralSecurityContainer,
  AdminSamlSecurityContainer,
]);

export default SamlSecurityManagementContentsWrapper;
