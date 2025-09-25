import type { FC } from 'react';
import React, { useState } from 'react';

import { useTranslation } from 'next-i18next';
import Link from 'next/link';

import { apiv3Put } from '~/client/util/apiv3-client';
import { toastSuccess, toastError } from '~/client/util/toastr';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:passwordReset');


const PasswordResetExecutionForm: FC = () => {
  const { t } = useTranslation(['translation', 'commons']);

  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [validationErrorI18n, setValidationErrorI18n] = useState('');

  // get token from URL
  const pathname = window.location.pathname.split('/');
  const token = pathname[2];

  const changePassword = async(e) => {
    e.preventDefault();

    if (newPassword === '' || newPasswordConfirm === '') {
      setValidationErrorI18n('personal_settings.password_is_not_set');
      return;
    }

    if (newPassword !== newPasswordConfirm) {
      setValidationErrorI18n('forgot_password.password_and_confirm_password_does_not_match');
      return;
    }

    try {
      await apiv3Put('/forgot-password', {
        token, newPassword, newPasswordConfirm,
      });

      setValidationErrorI18n('');

      toastSuccess(t('toaster.update_successed', { target: t('Password'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
      logger.error(err);
    }

  };

  return (
    <form role="form" onSubmit={changePassword}>
      <div>
        <div className="input-group">
          <input
            name="password"
            placeholder={t('forgot_password.new_password')}
            className="form-control"
            type="password"
            onChange={e => setNewPassword(e.target.value)}
          />
        </div>
      </div>
      <div>
        <div className="input-group">
          <input
            name="password"
            placeholder={t('forgot_password.confirm_new_password')}
            className="form-control"
            type="password"
            onChange={e => setNewPasswordConfirm(e.target.value)}
          />
        </div>
        {validationErrorI18n !== '' && (
          <p className="text-danger mt-2">{t(validationErrorI18n)}</p>
        )}
      </div>
      <div>
        <input name="reset-password-btn" className="btn btn-lg btn-primary" value={t('forgot_password.reset_password')} type="submit" />
      </div>
      <Link href="/login" prefetch={false}>
        <span className="material-symbols-outlined">login</span>{t('forgot_password.sign_in_instead')}
      </Link>
    </form>
  );
};


export default PasswordResetExecutionForm;
