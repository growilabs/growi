import React, { useCallback, useEffect } from 'react';

import { useTranslation } from 'next-i18next';
import { useForm } from 'react-hook-form';

import AdminAppContainer from '~/client/services/AdminAppContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';

import { withUnstatedContainers } from '../../UnstatedUtils';

import { SesSetting } from './SesSetting';
import { SmtpSetting } from './SmtpSetting';


type Props = {
  adminAppContainer: AdminAppContainer,
}


const MailSetting = (props: Props) => {
  const { t } = useTranslation(['admin', 'commons']);
  const { adminAppContainer } = props;

  const transmissionMethods = ['smtp', 'ses'];

  const {
    register,
    handleSubmit,
    reset,
    watch,
  } = useForm();

  // Watch the transmission method to dynamically switch between SMTP and SES settings
  const currentTransmissionMethod = watch('transmissionMethod', adminAppContainer.state.transmissionMethod || 'smtp');

  // Reset form when adminAppContainer state changes
  useEffect(() => {
    reset({
      fromAddress: adminAppContainer.state.fromAddress || '',
      transmissionMethod: adminAppContainer.state.transmissionMethod || 'smtp',
      smtpHost: adminAppContainer.state.smtpHost || '',
      smtpPort: adminAppContainer.state.smtpPort || '',
      smtpUser: adminAppContainer.state.smtpUser || '',
      smtpPassword: adminAppContainer.state.smtpPassword || '',
      sesAccessKeyId: adminAppContainer.state.sesAccessKeyId || '',
      sesSecretAccessKey: adminAppContainer.state.sesSecretAccessKey || '',
    });
  }, [
    adminAppContainer.state.fromAddress,
    adminAppContainer.state.transmissionMethod,
    adminAppContainer.state.smtpHost,
    adminAppContainer.state.smtpPort,
    adminAppContainer.state.smtpUser,
    adminAppContainer.state.smtpPassword,
    adminAppContainer.state.sesAccessKeyId,
    adminAppContainer.state.sesSecretAccessKey,
    reset,
  ]);

  const onSubmit = useCallback(async(data) => {
    try {
      // Await all setState completions before API call
      await Promise.all([
        adminAppContainer.changeFromAddress(data.fromAddress),
        adminAppContainer.changeTransmissionMethod(data.transmissionMethod),
        adminAppContainer.changeSmtpHost(data.smtpHost),
        adminAppContainer.changeSmtpPort(data.smtpPort),
        adminAppContainer.changeSmtpUser(data.smtpUser),
        adminAppContainer.changeSmtpPassword(data.smtpPassword),
        adminAppContainer.changeSesAccessKeyId(data.sesAccessKeyId),
        adminAppContainer.changeSesSecretAccessKey(data.sesSecretAccessKey),
      ]);

      await adminAppContainer.updateMailSettingHandler();
      toastSuccess(t('toaster.update_successed', { target: t('admin:app_setting.mail_settings'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }, [adminAppContainer, t]);

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
    <form onSubmit={handleSubmit(onSubmit)}>
      {!adminAppContainer.state.isMailerSetup && (
        <div className="alert alert-danger"><span className="material-symbols-outlined">error</span> {t('admin:app_setting.mailer_is_not_set_up')}</div>
      )}
      <div className="row mb-4">
        <label className="col-md-3 col-form-label text-end">{t('admin:app_setting.from_e-mail_address')}</label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            placeholder={`${t('eg')} mail@growi.org`}
            {...register('fromAddress')}
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
                  id={`transmission-method-radio-${method}`}
                  value={method}
                  {...register('transmissionMethod')}
                />
                <label className="form-label form-check-label" htmlFor={`transmission-method-radio-${method}`}>{t(`admin:app_setting.${method}_label`)}</label>
              </div>
            );
          })}
        </div>
      </div>

      {currentTransmissionMethod === 'smtp' && <SmtpSetting register={register} />}
      {currentTransmissionMethod === 'ses' && <SesSetting register={register} />}

      <div className="row my-3">
        <div className="col-md-3"></div>
        <div className="col-md-9">
          <button type="submit" className="btn btn-primary" disabled={adminAppContainer.state.retrieveError != null}>
            { t('Update') }
          </button>
          {adminAppContainer.state.transmissionMethod === 'smtp' && (
            <button type="button" className="btn btn-secondary ms-4" onClick={sendTestEmailHandler}>
              {t('admin:app_setting.send_test_email')}
            </button>
          )}
        </div>
      </div>
    </form>
  );

};

/**
 * Wrapper component for using unstated
 */
const MailSettingWrapper = withUnstatedContainers(MailSetting, [AdminAppContainer]);

export default MailSettingWrapper;
