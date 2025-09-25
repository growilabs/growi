import React from 'react';

import { useTranslation } from 'next-i18next';

import AdminAppContainer from '~/client/services/AdminAppContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';

import { withUnstatedContainers } from '../../UnstatedUtils';

import SesSetting from './SesSetting';
import SmtpSetting from './SmtpSetting';


type Props = {
  adminAppContainer: AdminAppContainer,
}


const MailSetting = (props: Props) => {
  const { t } = useTranslation(['admin', 'commons']);
  const { adminAppContainer } = props;

  const transmissionMethods = ['smtp', 'ses'];

  async function submitHandler() {
    try {
      await adminAppContainer.updateMailSettingHandler();
      toastSuccess(t('toaster.update_successed', { target: t('admin:app_setting.mail_settings'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }

  async function sendTestEmailHandler() {
    const { adminAppContainer } = props;
    try {
      await adminAppContainer.sendTestEmail();
      toastSuccess(t('admin:app_setting.success_to_send_test_email'));
    }
    catch (err) {
      toastError(err);
    }
  }


  return (
    <React.Fragment>
      {!adminAppContainer.state.isMailerSetup && (
        <div className="alert alert-danger"><span className="material-symbols-outlined">error</span> {t('admin:app_setting.mailer_is_not_set_up')}</div>
      )}
      <div className="row mb-5">
        <label className="col-md-3 col-form-label text-end">{t('admin:app_setting.from_e-mail_address')}</label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            placeholder={`${t('eg')} mail@growi.org`}
            value={adminAppContainer.state.fromAddress || ''}
            onChange={(e) => { adminAppContainer.changeFromAddress(e.target.value) }}
          />
        </div>
      </div>

      <div className="row mb-2">
        <label className="form-label text-start text-md-end col-md-3 col-form-label">
          {t('admin:app_setting.transmission_method')}
        </label>
        <div className="col-md-6 py-2">
          {transmissionMethods.map((method) => {
            return (
              <div key={method} className="form-check form-check-inline">
                <input
                  type="radio"
                  className="form-check-input"
                  name="transmission-method"
                  id={`transmission-method-radio-${method}`}
                  checked={adminAppContainer.state.transmissionMethod === method}
                  onChange={(e) => {
                    adminAppContainer.changeTransmissionMethod(method);
                  }}
                />
                <label className="form-label form-check-label" htmlFor={`transmission-method-radio-${method}`}>{t(`admin:app_setting.${method}_label`)}</label>
              </div>
            );
          })}
        </div>
      </div>

      {adminAppContainer.state.transmissionMethod === 'smtp' && <SmtpSetting />}
      {adminAppContainer.state.transmissionMethod === 'ses' && <SesSetting />}

      <div className="row my-3">
        <div className="mx-auto">
          <button type="button" className="btn btn-primary" onClick={submitHandler} disabled={adminAppContainer.state.retrieveError != null}>
            { t('Update') }
          </button>
          {adminAppContainer.state.transmissionMethod === 'smtp' && (
            <button type="button" className="btn btn-secondary ms-4" onClick={sendTestEmailHandler}>
              {t('admin:app_setting.send_test_email')}
            </button>
          )}
        </div>
      </div>
    </React.Fragment>
  );

};

/**
 * Wrapper component for using unstated
 */
const MailSettingWrapper = withUnstatedContainers(MailSetting, [AdminAppContainer]);

export default MailSettingWrapper;
