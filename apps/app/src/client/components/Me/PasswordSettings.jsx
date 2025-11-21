import React, { useCallback } from 'react';

import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

import { apiv3Get, apiv3Put } from '~/client/util/apiv3-client';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { useSWRxPersonalSettings } from '~/stores/personal-settings';


class PasswordSettings extends React.Component {

  constructor() {
    super();

    this.state = {
      retrieveError: null,
      oldPassword: '',
      newPassword: '',
      newPasswordConfirm: '',
      isPasswordSet: false,
      minPasswordLength: null,
    };

    this.submitHandler = this.submitHandler.bind(this);
    this.onChangeOldPassword = this.onChangeOldPassword.bind(this);

  }

  async componentDidMount() {
    try {
      const res = await apiv3Get('/personal-setting/is-password-set');
      const { isPasswordSet, minPasswordLength } = res.data;
      this.setState({ isPasswordSet, minPasswordLength });
    }
    catch (err) {
      toastError(err);
      this.setState({ retrieveError: err });
    }

  }

  async submitHandler() {
    const { t, onSubmit } = this.props;
    const { oldPassword, newPassword, newPasswordConfirm } = this.state;

    try {
      await apiv3Put('/personal-setting/password', {
        oldPassword, newPassword, newPasswordConfirm,
      });
      this.setState({ oldPassword: '', newPassword: '', newPasswordConfirm: '' });
      if (onSubmit != null) {
        onSubmit();
      }
      toastSuccess(t('toaster.update_successed', { target: t('Password'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }

  }

  onChangeOldPassword(oldPassword) {
    this.setState({ oldPassword });
  }

  onChangeNewPassword(newPassword) {
    this.setState({ newPassword });
  }

  onChangeNewPasswordConfirm(newPasswordConfirm) {
    this.setState({ newPasswordConfirm });
  }

  render() {
    const { t } = this.props;
    const { newPassword, newPasswordConfirm, minPasswordLength } = this.state;
    const isIncorrectConfirmPassword = (newPassword !== newPasswordConfirm);
    if (this.state.retrieveError != null) {
      throw new Error(this.state.retrieveError.message);
    }

    return (
      <React.Fragment>
        { (!this.state.isPasswordSet) && (
          <div className="alert alert-warning">{ t('personal_settings.password_is_not_set') }</div>
        ) }

        {(this.state.isPasswordSet)
          ? <h2 className="border-bottom mt-4 mb-5 pb-2 fs-4">{t('personal_settings.update_password')}</h2>
          : <h2 className="border-bottom mt-4 mb-5 pb-2 fs-4">{t('personal_settings.set_new_password')}</h2>}
        {(this.state.isPasswordSet)
        && (
          <div className="row mb-3">
            <label htmlFor="oldPassword" className="col-md-3 text-md-end col-form-label">{ t('personal_settings.current_password') }</label>
            <div className="col-md-5">
              <input
                className="form-control"
                type="password"
                name="oldPassword"
                value={this.state.oldPassword}
                onChange={(e) => { this.onChangeOldPassword(e.target.value) }}
              />
            </div>
          </div>
        )}
        <div className="row mb-3">
          <label htmlFor="newPassword" className="col-md-3 text-md-end col-form-label">{t('personal_settings.new_password') }</label>
          <div className="col-md-5">
            {/* to prevent autocomplete username into userForm[email] in BasicInfoSettings component */}
            {/* https://developer.mozilla.org/en-US/docs/Web/Security/Securing_your_site/Turning_off_form_autocompletion */}
            <input type="password" autoComplete="new-password" style={{ display: 'none' }} />
            <input
              className="form-control"
              type="password"
              name="newPassword"
              value={this.state.newPassword}
              onChange={(e) => { this.onChangeNewPassword(e.target.value) }}
            />
          </div>
        </div>
        <div className={`row mb-3 ${isIncorrectConfirmPassword && 'has-error'}`}>
          <label htmlFor="newPasswordConfirm" className="col-md-3 text-md-end col-form-label">{t('personal_settings.new_password_confirm') }</label>
          <div className="col-md-5">
            <input
              className="form-control"
              type="password"
              name="newPasswordConfirm"
              value={this.state.newPasswordConfirm}
              onChange={(e) => { this.onChangeNewPasswordConfirm(e.target.value) }}
            />

            <p className="form-text text-muted">{t('page_register.form_help.password', { target: minPasswordLength }) }</p>
          </div>
        </div>

        <div className="row my-3">
          <div className="text-center">
            <button
              data-testid="grw-password-settings-update-button"
              type="button"
              className="btn btn-primary"
              onClick={this.submitHandler}
              disabled={isIncorrectConfirmPassword}
            >
              {t('Update')}
            </button>
          </div>
        </div>
      </React.Fragment>
    );
  }

}

PasswordSettings.propTypes = {
  t: PropTypes.func.isRequired, // i18next
  onSubmit: PropTypes.func,
};

const PasswordSettingsWrapperFC = (props) => {
  const { t } = useTranslation();
  const { mutate: mutatePersonalSettings } = useSWRxPersonalSettings();

  const submitHandler = useCallback(() => {
    mutatePersonalSettings();
  }, [mutatePersonalSettings]);


  return <PasswordSettings t={t} onSubmit={submitHandler} {...props} />;
};

export default PasswordSettingsWrapperFC;
