import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';

import { apiv3Get, apiv3Post } from '~/client/util/apiv3-client';
import { UserActivationErrorCode } from '~/interfaces/errors/user-activation';
import { RegistrationMode } from '~/interfaces/registration-mode';

import { toastError } from '../util/toastr';
import { CompleteUserRegistration } from './CompleteUserRegistration';

import styles from './CompleteUserRegistrationForm.module.scss';

const moduleClass = styles['complete-user-registration-form'] ?? '';

interface Props {
  email: string;
  token: string;
  errorCode?: UserActivationErrorCode;
  registrationMode: RegistrationMode;
  isEmailAuthenticationEnabled: boolean;
}

export const CompleteUserRegistrationForm: React.FC<Props> = (props: Props) => {
  const { t } = useTranslation();
  const {
    email,
    token,
    errorCode,
    registrationMode,
    isEmailAuthenticationEnabled,
  } = props;

  const forceDisableForm = errorCode != null || !isEmailAuthenticationEnabled;

  const [usernameAvailable, setUsernameAvailable] = useState(true);
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [disableForm, setDisableForm] = useState(forceDisableForm);
  const [isSuccessToRagistration, setIsSuccessToRagistration] = useState(false);

  const router = useRouter();

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      try {
        const { data } = await apiv3Get('/check-username', { username });
        if (data.ok) {
          setUsernameAvailable(data.valid);
        }
      } catch (error) {
        toastError(error);
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [username]);

  const handleSubmitRegistration = useCallback(
    async (e) => {
      e.preventDefault();
      setDisableForm(true);
      try {
        const res = await apiv3Post('/complete-registration', {
          username,
          name,
          password,
          token,
        });

        setIsSuccessToRagistration(true);

        const { redirectTo } = res.data;
        if (redirectTo != null) {
          router.push(redirectTo);
        }
      } catch (err) {
        toastError(err);
        setDisableForm(false);
        setIsSuccessToRagistration(false);
      }
    },
    [username, name, password, token, router],
  );

  if (
    isSuccessToRagistration &&
    registrationMode === RegistrationMode.RESTRICTED
  ) {
    return <CompleteUserRegistration />;
  }

  return (
    <>
      <div
        className={`${moduleClass} nologin-dialog mx-auto rounded-4 rounded-top-0`}
        id="nologin-dialog"
      >
        <div className="row mx-0">
          <div className="col-12 px-4">
            {errorCode != null &&
              errorCode === UserActivationErrorCode.TOKEN_NOT_FOUND && (
                <p className="alert alert-danger">
                  <span>Token not found</span>
                </p>
              )}

            {errorCode != null &&
              errorCode ===
                UserActivationErrorCode.USER_REGISTRATION_ORDER_IS_NOT_APPROPRIATE && (
                <p className="alert alert-danger">
                  <span>{t('message.incorrect_token_or_expired_url')}</span>
                </p>
              )}

            {!isEmailAuthenticationEnabled && (
              <p className="alert alert-danger">
                <span>{t('message.email_authentication_is_not_enabled')}</span>
              </p>
            )}

            <form onSubmit={handleSubmitRegistration} id="registration-form">
              <input type="hidden" name="token" value={token} />

              <div className="input-group">
                <span className="p-2 text-white opacity-75">
                  <span className="material-symbols-outlined">mail</span>
                </span>
                <input
                  type="text"
                  className="form-control rounded"
                  placeholder={t('Email')}
                  disabled
                  value={email}
                />
              </div>

              <div className="input-group" id="input-group-username">
                <span className="p-2 text-white opacity-75">
                  <span className="material-symbols-outlined">person</span>
                </span>
                <input
                  type="text"
                  className="form-control rounded"
                  placeholder={t('User ID')}
                  name="username"
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  disabled={forceDisableForm || disableForm}
                />
              </div>
              {!usernameAvailable && (
                <p className="form-text text-red">
                  <span id="help-block-username">
                    <span className="p-2 text-white opacity-75">
                      <span className="material-symbols-outlined">block</span>
                    </span>
                    {t('installer.unavaliable_user_id')}
                  </span>
                </p>
              )}

              <div className="input-group">
                <span className="p-2 text-white opacity-75">
                  <span className="material-symbols-outlined">sell</span>
                </span>
                <input
                  type="text"
                  className="form-control rounded"
                  placeholder={t('Name')}
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={forceDisableForm || disableForm}
                />
              </div>

              <div className="input-group">
                <span className="p-2 text-white opacity-75">
                  <span className="material-symbols-outlined">lock</span>
                </span>
                <input
                  type="password"
                  className="form-control rounded"
                  placeholder={t('Password')}
                  name="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={forceDisableForm || disableForm}
                />
              </div>

              <div className="input-group justify-content-center mt-4">
                <button
                  type="submit"
                  disabled={forceDisableForm || disableForm}
                  className="btn btn-secondary btn-register col-6 mx-auto d-flex"
                >
                  <span>
                    <span className="material-symbols-outlined">
                      person_add
                    </span>
                  </span>
                  <span className="flex-grow-1">{t('Create')}</span>
                </button>
              </div>

              <div className="input-group mt-5 d-flex">
                <a href="https://growi.org" className="link-growi-org">
                  <span className="growi">GROWI</span>
                  <span className="org">.org</span>
                </a>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
};
