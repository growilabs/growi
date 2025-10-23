import React, { useCallback, useEffect } from 'react';

import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useForm } from 'react-hook-form';

import AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';
import AdminLocalSecurityContainer from '~/client/services/AdminLocalSecurityContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { useIsMailerSetup } from '~/stores-universal/context';

import { withUnstatedContainers } from '../../UnstatedUtils';

type Props = {
  adminGeneralSecurityContainer: AdminGeneralSecurityContainer;
  adminLocalSecurityContainer: AdminLocalSecurityContainer;
};

const LocalSecuritySettingContents = (props: Props): JSX.Element => {
  const {
    adminGeneralSecurityContainer,
    adminLocalSecurityContainer,
  } = props;

  const { t } = useTranslation('admin');
  const { data: isMailerSetup = false } = useIsMailerSetup();

  const { register, handleSubmit, reset } = useForm();

  const { registrationMode, isPasswordResetEnabled, isEmailAuthenticationEnabled } = adminLocalSecurityContainer.state;
  const { isLocalEnabled } = adminGeneralSecurityContainer.state;

  useEffect(() => {
    reset({
      registrationWhitelist: adminLocalSecurityContainer.state.registrationWhitelist.join('\n'),
    });
  }, [reset, adminLocalSecurityContainer.state.registrationWhitelist]);

  const onSubmit = useCallback(async(data) => {
    try {
      await adminLocalSecurityContainer.changeRegistrationWhitelist(data.registrationWhitelist);
      await adminLocalSecurityContainer.updateLocalSecuritySetting();
      await adminGeneralSecurityContainer.retrieveSetupStratedies();
      toastSuccess(t('security_settings.updated_general_security_setting'));
    }
    catch (err) {
      toastError(err);
    }
  }, [t, adminGeneralSecurityContainer, adminLocalSecurityContainer]);

  return (
    <>
      {adminLocalSecurityContainer.state.retrieveError != null && (
        <div className="alert alert-danger">
          <p>
            {t('Error occurred')} : {adminLocalSecurityContainer.state.retrieveError}
          </p>
        </div>
      )}
      <h2 className="alert-anchor border-bottom">{t('security_settings.Local.name')}</h2>

      {adminLocalSecurityContainer.state.useOnlyEnvVars && (
        <p
          className="alert alert-info"
          // eslint-disable-next-line max-len
          dangerouslySetInnerHTML={{
            __html: t('security_settings.Local.note for the only env option', { env: 'LOCAL_STRATEGY_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS' }),
          }}
        />
      )}

      <div className="row mt-4 mb-5">
        <div className="col-6 offset-3">
          <div className="form-check form-switch form-check-success">
            <input
              type="checkbox"
              className="form-check-input"
              id="isLocalEnabled"
              checked={isLocalEnabled}
              onChange={() => adminGeneralSecurityContainer.switchIsLocalEnabled()}
              disabled={adminLocalSecurityContainer.state.useOnlyEnvVars}
            />
            <label className="form-label form-check-label" htmlFor="isLocalEnabled">
              {t('security_settings.Local.enable_local')}
            </label>
          </div>
          {!adminGeneralSecurityContainer.state.setupStrategies.includes('local') && isLocalEnabled && (
            <div className="badge bg-warning text-dark">{t('security_settings.setup_is_not_yet_complete')}</div>
          )}
        </div>
      </div>

      {isLocalEnabled && (
        <form onSubmit={handleSubmit(onSubmit)}>
          <h3 className="border-bottom">{t('security_settings.configuration')}</h3>

          <div className="row">
            <div className="col-12 col-md-4 text-start text-md-end py-2">
              <strong>{t('security_settings.register_limitation')}</strong>
            </div>
            <div className="col-12 col-md-8">
              <div className="dropdown">
                <button
                  className="btn btn-outline-secondary dropdown-toggle"
                  type="button"
                  id="dropdownMenuButton"
                  data-bs-toggle="dropdown"
                  aria-haspopup="true"
                  aria-expanded="true"
                >
                  {registrationMode === 'Open' && t('security_settings.registration_mode.open')}
                  {registrationMode === 'Restricted' && t('security_settings.registration_mode.restricted')}
                  {registrationMode === 'Closed' && t('security_settings.registration_mode.closed')}
                </button>
                <div className="dropdown-menu" aria-labelledby="dropdownMenuButton">
                  <button
                    className="dropdown-item"
                    type="button"
                    onClick={() => {
                      adminLocalSecurityContainer.changeRegistrationMode('Open');
                    }}
                  >
                    {t('security_settings.registration_mode.open')}
                  </button>
                  <button
                    className="dropdown-item"
                    type="button"
                    onClick={() => {
                      adminLocalSecurityContainer.changeRegistrationMode('Restricted');
                    }}
                  >
                    {t('security_settings.registration_mode.restricted')}
                  </button>
                  <button
                    className="dropdown-item"
                    type="button"
                    onClick={() => {
                      adminLocalSecurityContainer.changeRegistrationMode('Closed');
                    }}
                  >
                    {t('security_settings.registration_mode.closed')}
                  </button>
                </div>
              </div>
              <p className="form-text text-muted small">{t('security_settings.register_limitation_desc')}</p>
            </div>
          </div>
          <div className="row">
            <div className="col-12 col-md-4 text-start text-md-end">
              <strong dangerouslySetInnerHTML={{ __html: t('security_settings.The whitelist of registration permission E-mail address') }} />
            </div>
            <div className="col-12 col-md-8">
              <textarea
                className="form-control"
                {...register('registrationWhitelist')}
              />
              <p className="form-text text-muted small">
                {t('security_settings.restrict_emails')}
                <br />
                {t('security_settings.for_example')}
                <code>@growi.org</code>
                {t('security_settings.in_this_case')}
                <br />
                {t('security_settings.insert_single')}
              </p>
            </div>
          </div>

          <div className="row">
            <label className="col-12 col-md-4 text-start text-md-end  col-form-label">{t('security_settings.Local.password_reset_by_users')}</label>
            <div className="col-12 col-md-8">
              <div className="form-check form-switch form-check-success">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id="isPasswordResetEnabled"
                  checked={isPasswordResetEnabled}
                  onChange={() => adminLocalSecurityContainer.switchIsPasswordResetEnabled()}
                />
                <label className="form-label form-check-label" htmlFor="isPasswordResetEnabled">
                  {t('security_settings.Local.enable_password_reset_by_users')}
                </label>
              </div>
              {!isMailerSetup && (
                <div className="alert alert-warning p-2 my-1 small d-inline-block">
                  <span>{t('commons:alert.password_reset_please_enable_mailer')}</span>
                  <Link href="/admin/app#mail-settings">
                    <span className="material-symbols-outlined">link</span> {t('app_setting.mail_settings')}
                  </Link>
                </div>
              )}
              <p className="form-text text-muted small">
                {t('security_settings.Local.password_reset_desc')}
              </p>
            </div>
          </div>

          <div className="row">
            <label className="col-12 col-md-4 text-start text-md-end  col-form-label">{t('security_settings.Local.email_authentication')}</label>
            <div className="col-12 col-md-8">
              <div className="form-check form-switch form-check-success">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id="isEmailAuthenticationEnabled"
                  checked={isEmailAuthenticationEnabled}
                  onChange={() => adminLocalSecurityContainer.switchIsEmailAuthenticationEnabled()}
                />
                <label className="form-label form-check-label" htmlFor="isEmailAuthenticationEnabled">
                  {t('security_settings.Local.enable_email_authentication')}
                </label>
              </div>
              {!isMailerSetup && (
                <div className="alert alert-warning p-2 my-1 small d-inline-block">
                  <span>{t('commons:alert.please_enable_mailer')}</span>
                  <Link href="/admin/app#mail-settings">
                    <span className="material-symbols-outlined">link</span> {t('app_setting.mail_settings')}
                  </Link>
                </div>
              )}
              <p className="form-text text-muted small">
                {t('security_settings.Local.enable_email_authentication_desc')}
              </p>
            </div>
          </div>

          <div className="row my-3">
            <div className="offset-3 col-6">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={adminLocalSecurityContainer.state.retrieveError != null}
              >
                {t('Update')}
              </button>
            </div>
          </div>
        </form>
      )}
    </>
  );
};

const LocalSecuritySettingContentsWrapper = withUnstatedContainers(LocalSecuritySettingContents, [
  AdminGeneralSecurityContainer,
  AdminLocalSecurityContainer,
]);

export default LocalSecuritySettingContentsWrapper;
