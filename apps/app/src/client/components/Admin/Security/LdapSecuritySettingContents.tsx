import React, {
  useState, useEffect, useCallback,
} from 'react';

import { useTranslation } from 'next-i18next';
import { useForm } from 'react-hook-form';

import AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';
import AdminLdapSecurityContainer from '~/client/services/AdminLdapSecurityContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';

import { withUnstatedContainers } from '../../UnstatedUtils';

import LdapAuthTestModal from './LdapAuthTestModal';


type Props = {
  adminGeneralSecurityContainer: AdminGeneralSecurityContainer;
  adminLdapSecurityContainer: AdminLdapSecurityContainer;
};

const LdapSecuritySettingContents = (props: Props) => {
  const { adminGeneralSecurityContainer, adminLdapSecurityContainer } = props;

  const { t } = useTranslation('admin');

  const { isLdapEnabled } = adminGeneralSecurityContainer.state;
  const {
    serverUrl, ldapBindDN, ldapBindDNPassword, ldapSearchFilter,
    ldapAttrMapUsername, ldapAttrMapMail, ldapAttrMapName,
    ldapGroupSearchBase, ldapGroupSearchFilter, ldapGroupDnProperty,
  } = adminLdapSecurityContainer.state;

  const [isLdapAuthTestModalShown, setIsLdapAuthTestModalShown] = useState(false);

  const { register, handleSubmit, reset } = useForm();

  useEffect(() => {
    reset({
      serverUrl,
      ldapBindDN,
      ldapBindDNPassword,
      ldapSearchFilter,
      ldapAttrMapUsername,
      ldapAttrMapMail,
      ldapAttrMapName,
      ldapGroupSearchBase,
      ldapGroupSearchFilter,
      ldapGroupDnProperty,
    });
  }, [
    reset, serverUrl, ldapBindDN, ldapBindDNPassword, ldapSearchFilter,
    ldapAttrMapUsername, ldapAttrMapMail, ldapAttrMapName,
    ldapGroupSearchBase, ldapGroupSearchFilter, ldapGroupDnProperty,
  ]);

  const onSubmit = useCallback(async(data) => {
    try {
      await adminLdapSecurityContainer.changeServerUrl(data.serverUrl);
      await adminLdapSecurityContainer.changeBindDN(data.ldapBindDN);
      await adminLdapSecurityContainer.changeBindDNPassword(data.ldapBindDNPassword);
      await adminLdapSecurityContainer.changeSearchFilter(data.ldapSearchFilter);
      await adminLdapSecurityContainer.changeAttrMapUsername(data.ldapAttrMapUsername);
      await adminLdapSecurityContainer.changeAttrMapMail(data.ldapAttrMapMail);
      await adminLdapSecurityContainer.changeAttrMapName(data.ldapAttrMapName);
      await adminLdapSecurityContainer.changeGroupSearchBase(data.ldapGroupSearchBase);
      await adminLdapSecurityContainer.changeGroupSearchFilter(data.ldapGroupSearchFilter);
      await adminLdapSecurityContainer.changeGroupDnProperty(data.ldapGroupDnProperty);
      await adminLdapSecurityContainer.updateLdapSetting();
      await adminGeneralSecurityContainer.retrieveSetupStratedies();
      toastSuccess(t('security_settings.ldap.updated_ldap'));
    }
    catch (err) {
      toastError(err);
    }
  }, [t, adminLdapSecurityContainer, adminGeneralSecurityContainer]);

  const openLdapAuthTestModal = useCallback(() => {
    setIsLdapAuthTestModalShown(true);
  }, []);

  const closeLdapAuthTestModal = useCallback(() => {
    setIsLdapAuthTestModalShown(false);
  }, []);

  return (
    <React.Fragment>

      <h2 className="alert-anchor border-bottom mb-4">
        LDAP
      </h2>

      <div className="row my-4">
        <div className="col-6 offset-3">
          <div className="form-check form-switch form-check-success">
            <input
              id="isLdapEnabled"
              className="form-check-input"
              type="checkbox"
              checked={isLdapEnabled}
              onChange={() => { adminGeneralSecurityContainer.switchIsLdapEnabled() }}
            />
            <label className="form-label form-check-label" htmlFor="isLdapEnabled">
              {t('security_settings.ldap.enable_ldap')}
            </label>
          </div>
          {(!adminGeneralSecurityContainer.state.setupStrategies.includes('ldap') && isLdapEnabled)
              && <div className="badge text-bg-warning">{t('security_settings.setup_is_not_yet_complete')}</div>}
        </div>
      </div>


      {isLdapEnabled && (
        <form onSubmit={handleSubmit(onSubmit)}>

          <h3 className="border-bottom mb-4">{t('security_settings.configuration')}</h3>

          <div className="row my-3">
            <label htmlFor="serverUrl" className="text-start text-md-end col-md-3 col-form-label">
              Server URL
            </label>
            <div className="col-md-9">
              <input
                className="form-control"
                type="text"
                {...register('serverUrl')}
              />
              <small>
                <p
                  className="form-text text-muted"
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: t('security_settings.ldap.server_url_detail') }}
                />
                {t('security_settings.example')}: <code>ldaps://ldap.company.com/ou=people,dc=company,dc=com</code>
              </small>
            </div>
          </div>

          <div className="row my-3">
            <label className="form-label text-start text-md-end col-md-3 col-form-label">
              <strong>{t('security_settings.ldap.bind_mode')}</strong>
            </label>
            <div className="col-md-9">
              <div className="dropdown">
                <button
                  className="btn btn-outline-secondary dropdown-toggle"
                  type="button"
                  id="dropdownMenuButton"
                  data-bs-toggle="dropdown"
                  aria-haspopup="true"
                  aria-expanded="true"
                >
                  {adminLdapSecurityContainer.state.isUserBind
                    ? <span className="pull-left">{t('security_settings.ldap.bind_user')}</span>
                    : <span className="pull-left">{t('security_settings.ldap.bind_manager')}</span>}
                </button>
                <div className="dropdown-menu" aria-labelledby="dropdownMenuButton">
                  <button className="dropdown-item" type="button" onClick={() => { adminLdapSecurityContainer.changeLdapBindMode(true) }}>
                    {t('security_settings.ldap.bind_user')}
                  </button>
                  <button className="dropdown-item" type="button" onClick={() => { adminLdapSecurityContainer.changeLdapBindMode(false) }}>
                    {t('security_settings.ldap.bind_manager')}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="row my-3">
            <label className="form-label text-start text-md-end col-md-3 col-form-label">
              <strong>Bind DN</strong>
            </label>
            <div className="col-md-9">
              <input
                className="form-control"
                type="text"
                {...register('ldapBindDN')}
              />
              {(adminLdapSecurityContainer.state.isUserBind === true) ? (
                <p className="form-text text-muted">
                  <small>
                    {t('security_settings.ldap.bind_DN_user_detail1')}<br />
                    {/* eslint-disable-next-line react/no-danger */}
                    <span dangerouslySetInnerHTML={{ __html: t('security_settings.ldap.bind_DN_user_detail2') }} /><br />
                    {t('security_settings.example')}1: <code>uid={'{{ username }}'},dc=domain,dc=com</code><br />
                    {t('security_settings.example')}2: <code>{'{{ username }}'}@domain.com</code>
                  </small>
                </p>
              )
                : (
                  <p className="form-text text-muted">
                    <small>
                      {t('security_settings.ldap.bind_DN_manager_detail')}<br />
                      {t('security_settings.example')}1: <code>uid=admin,dc=domain,dc=com</code><br />
                      {t('security_settings.example')}2: <code>admin@domain.com</code>
                    </small>
                  </p>
                )}
            </div>
          </div>

          <div className="row my-3">
            <label className="text-start text-md-end col-md-3 col-form-label" htmlFor="bindDNPassword">
              <strong>{t('security_settings.ldap.bind_DN_password')}</strong>
            </label>
            <div className="col-md-9">
              {(adminLdapSecurityContainer.state.isUserBind) ? (
                <p className="card custom-card">
                  <small>
                    {t('security_settings.ldap.bind_DN_password_user_detail')}
                  </small>
                </p>
              )
                : (
                  <>
                    <input
                      className="form-control"
                      type="password"
                      {...register('ldapBindDNPassword')}
                    />
                    <p className="form-text text-muted">
                      <small>{t('security_settings.ldap.bind_DN_password_manager_detail')}</small>
                    </p>
                  </>
                )}
            </div>
          </div>

          <div className="row my-3">
            <label className="form-label text-start text-md-end col-md-3 col-form-label">
              <strong>{t('security_settings.ldap.search_filter')}</strong>
            </label>
            <div className="col-md-9">
              <input
                className="form-control"
                type="text"
                {...register('ldapSearchFilter')}
              />
              <p className="form-text text-muted">
                <small>
                  {t('security_settings.ldap.search_filter_detail1')}<br />
                  {/* eslint-disable-next-line react/no-danger */}
                  <span dangerouslySetInnerHTML={{ __html: t('security_settings.ldap.search_filter_detail2') }} /><br />
                  {/* eslint-disable-next-line react/no-danger */}
                  <span dangerouslySetInnerHTML={{ __html: t('security_settings.ldap.search_filter_detail3') }} />
                </small>
              </p>
              <p className="form-text text-muted">
                <small>
                  {t('security_settings.example')}1 - {t('security_settings.ldap.search_filter_example1')}:
                  <code>(|(uid={'{{username}}'})(mail={'{{username}}'}))</code><br />
                  {t('security_settings.example')}2 - {t('security_settings.ldap.search_filter_example2')}:
                  <code>(sAMAccountName={'{{username}}'})</code>
                </small>
              </p>
            </div>
          </div>

          <h3 className="alert-anchor border-bottom mb-4">
            Attribute Mapping ({t('optional')})
          </h3>

          <div className="row my-3">
            <label className="form-label text-start text-md-end col-md-3 col-form-label" htmlFor="attrMapUsername">
              <strong>{t('username')}</strong>
            </label>
            <div className="col-md-9">
              <input
                className="form-control"
                type="text"
                placeholder="Default: uid"
                {...register('ldapAttrMapUsername')}
              />
              <p className="form-text text-muted">
                {/* eslint-disable-next-line react/no-danger */}
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.ldap.username_detail') }} />
              </p>
            </div>
          </div>

          <div className="row my-3">
            <div className="offset-md-3 col-md-9">
              <div className="form-check form-check-success">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id="isSameUsernameTreatedAsIdenticalUser"
                  checked={adminLdapSecurityContainer.state.isSameUsernameTreatedAsIdenticalUser}
                  onChange={() => { adminLdapSecurityContainer.switchIsSameUsernameTreatedAsIdenticalUser() }}
                />
                <label
                  className="form-check-label"
                  htmlFor="isSameUsernameTreatedAsIdenticalUser"
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: t('security_settings.Treat username matching as identical') }}
                />
              </div>
              <p className="form-text text-muted">
                {/* eslint-disable-next-line react/no-danger */}
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.Treat username matching as identical_warn') }} />
              </p>
            </div>
          </div>

          <div className="row my-3">
            <label className="form-label text-start text-md-end col-md-3 col-form-label" htmlFor="attrMapMail">
              <strong>{t('Email')}</strong>
            </label>
            <div className="col-md-9">
              <input
                className="form-control"
                type="text"
                placeholder="Default: mail"
                {...register('ldapAttrMapMail')}
              />
              <p className="form-text text-muted">
                <small>
                  {t('security_settings.ldap.mail_detail')}
                </small>
              </p>
            </div>
          </div>

          <div className="row my-3">
            <label className="form-label text-start text-md-end col-md-3 col-form-label" htmlFor="attrMapName">
              <strong>{t('Name')}</strong>
            </label>
            <div className="col-md-9">
              <input
                className="form-control"
                type="text"
                {...register('ldapAttrMapName')}
              />
              <p className="form-text text-muted">
                <small>
                  {t('security_settings.ldap.name_detail')}
                </small>
              </p>
            </div>
          </div>


          <h3 className="alert-anchor border-bottom mb-4">
            {t('security_settings.ldap.group_search_filter')} ({t('optional')})
          </h3>

          <div className="row my-3">
            <label className="form-label text-start text-md-end col-md-3 col-form-label" htmlFor="groupSearchBase">
              <strong>{t('security_settings.ldap.group_search_base_DN')}</strong>
            </label>
            <div className="col-md-9">
              <input
                className="form-control"
                type="text"
                {...register('ldapGroupSearchBase')}
              />
              <p className="form-text text-muted">
                <small>
                  {/* eslint-disable-next-line react/no-danger */}
                  <span dangerouslySetInnerHTML={{ __html: t('security_settings.ldap.group_search_base_DN_detail') }} /><br />
                  {t('security_settings.example')}: <code>ou=groups,dc=domain,dc=com</code>
                </small>
              </p>
            </div>
          </div>

          <div className="row my-3">
            <label className="form-label text-start text-md-end col-md-3 col-form-label" htmlFor="groupSearchFilter">
              <strong>{t('security_settings.ldap.group_search_filter')}</strong>
            </label>
            <div className="col-md-9">
              <input
                className="form-control"
                type="text"
                {...register('ldapGroupSearchFilter')}
              />
              <p className="form-text text-muted">
                <small>
                  {/* eslint-disable react/no-danger */}
                  <span dangerouslySetInnerHTML={{ __html: t('security_settings.ldap.group_search_filter_detail1') }} /><br />
                  <span dangerouslySetInnerHTML={{ __html: t('security_settings.ldap.group_search_filter_detail2') }} /><br />
                  <span dangerouslySetInnerHTML={{ __html: t('security_settings.ldap.group_search_filter_detail3') }} />
                  {/* eslint-enable react/no-danger */}
                </small>
              </p>
              <p className="form-text text-muted">
                <small>
                  {t('security_settings.example')}:
                  {/* eslint-disable-next-line react/no-danger */}
                  <span dangerouslySetInnerHTML={{ __html: t('security_settings.ldap.group_search_filter_detail4') }} />
                </small>
              </p>
            </div>
          </div>

          <div className="row my-3">
            <label className="form-label text-start text-md-end col-md-3 col-form-label" htmlFor="groupDnProperty">
              <strong>{t('security_settings.ldap.group_search_user_DN_property')}</strong>
            </label>
            <div className="col-md-9">
              <input
                className="form-control"
                type="text"
                placeholder="Default: uid"
                {...register('ldapGroupDnProperty')}
              />
              <p className="form-text text-muted">
                {/* eslint-disable-next-line react/no-danger */}
                <small dangerouslySetInnerHTML={{ __html: t('security_settings.ldap.group_search_user_DN_property_detail') }} />
              </p>
            </div>
          </div>
          <div className="row my-3">
            <div className="offset-3 col-5">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={adminLdapSecurityContainer.state.retrieveError != null}
              >
                {t('Update')}
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary ms-2"
                onClick={openLdapAuthTestModal}
              >{t('security_settings.ldap.test_config')}
              </button>
            </div>
          </div>

        </form>
      )}


      <LdapAuthTestModal isOpen={isLdapAuthTestModalShown} onClose={closeLdapAuthTestModal} />

    </React.Fragment>
  );
};

const LdapSecuritySettingContentsWrapper = withUnstatedContainers(LdapSecuritySettingContents, [
  AdminGeneralSecurityContainer,
  AdminLdapSecurityContainer,
]);

export default LdapSecuritySettingContentsWrapper;
