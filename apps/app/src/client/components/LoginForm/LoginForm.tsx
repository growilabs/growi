import React, {
  useState, useEffect, useCallback, type JSX,
} from 'react';

import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import { useRouter } from 'next/router';
import ReactCardFlip from 'react-card-flip';

import { apiv3Post } from '~/client/util/apiv3-client';
import { useTWithOpt } from '~/client/util/t-with-opt';
import type { IExternalAccountLoginError } from '~/interfaces/errors/external-account-login-error';
import { LoginErrorCode } from '~/interfaces/errors/login-error';
import type { IErrorV3 } from '~/interfaces/errors/v3-error';
import type { IExternalAuthProviderType } from '~/interfaces/external-auth-provider';
import { RegistrationMode } from '~/interfaces/registration-mode';
import { toArrayIfNot } from '~/utils/array-utils';

import { CompleteUserRegistration } from '../CompleteUserRegistration';

import { ExternalAuthButton } from './ExternalAuthButton';

import styles from './LoginForm.module.scss';


const moduleClass = styles['login-form'];


type LoginFormProps = {
  username?: string,
  name?: string,
  email?: string,
  isEmailAuthenticationEnabled: boolean,
  registrationMode: RegistrationMode,
  registrationWhitelist: string[],
  isPasswordResetEnabled: boolean,
  isLocalStrategySetup: boolean,
  isLdapStrategySetup: boolean,
  isLdapSetupFailed: boolean,
  enabledExternalAuthType?: IExternalAuthProviderType[],
  isMailerSetup?: boolean,
  externalAccountLoginError?: IExternalAccountLoginError,
  minPasswordLength: number,
}
export const LoginForm = (props: LoginFormProps): JSX.Element => {
  const { t } = useTranslation();

  const router = useRouter();

  const {
    isLocalStrategySetup, isLdapStrategySetup, isLdapSetupFailed, isPasswordResetEnabled,
    isEmailAuthenticationEnabled, registrationMode, registrationWhitelist, isMailerSetup, enabledExternalAuthType, minPasswordLength,
  } = props;

  const isLocalOrLdapStrategiesEnabled = isLocalStrategySetup || isLdapStrategySetup;
  const isSomeExternalAuthEnabled = enabledExternalAuthType != null && enabledExternalAuthType.length > 0;

  // states
  const [isRegistering, setIsRegistering] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // For Login
  const [usernameForLogin, setUsernameForLogin] = useState('');
  const [passwordForLogin, setPasswordForLogin] = useState('');
  const [loginErrors, setLoginErrors] = useState<IErrorV3[]>([]);
  // For Register
  const [usernameForRegister, setUsernameForRegister] = useState('');
  const [nameForRegister, setNameForRegister] = useState('');
  const [emailForRegister, setEmailForRegister] = useState('');
  const [passwordForRegister, setPasswordForRegister] = useState('');
  const [registerErrors, setRegisterErrors] = useState<IErrorV3[]>([]);
  // For UserActivation
  const [emailForRegistrationOrder, setEmailForRegistrationOrder] = useState('');

  const [isSuccessToRagistration, setIsSuccessToRagistration] = useState(false);

  const isRegistrationEnabled = isLocalStrategySetup && registrationMode !== RegistrationMode.CLOSED;

  const tWithOpt = useTWithOpt();

  useEffect(() => {
    const { hash } = window.location;
    if (hash === '#register') {
      setIsRegistering(true);
    }
  }, []);

  const resetLoginErrors = useCallback(() => {
    if (loginErrors.length === 0) return;
    setLoginErrors([]);
  }, [loginErrors.length]);

  const handleLoginWithLocalSubmit = useCallback(async(e) => {
    e.preventDefault();
    resetLoginErrors();
    setIsLoading(true);

    const loginForm = {
      username: usernameForLogin,
      password: passwordForLogin,
    };

    try {
      const res = await apiv3Post('/login', { loginForm });
      const { redirectTo } = res.data;

      if (redirectTo != null) {
        return router.push(redirectTo);
      }

      return router.push('/');
    }
    catch (err) {
      const errs = toArrayIfNot(err);
      setLoginErrors(errs);
      setIsLoading(false);
    }
    return;

  }, [passwordForLogin, resetLoginErrors, router, usernameForLogin]);

  // separate errors based on error code
  const separateErrorsBasedOnErrorCode = useCallback((errors: IErrorV3[]) => {
    const loginErrorListForDangerouslySetInnerHTML: IErrorV3[] = [];
    const loginErrorList: IErrorV3[] = [];

    errors.forEach((err) => {
      if (err.code === LoginErrorCode.PROVIDER_DUPLICATED_USERNAME_EXCEPTION) {
        loginErrorListForDangerouslySetInnerHTML.push(err);
      }
      else {
        loginErrorList.push(err);
      }
    });

    return [loginErrorListForDangerouslySetInnerHTML, loginErrorList];
  }, []);

  // wrap error elements which use dangerouslySetInnerHtml
  const generateDangerouslySetErrors = useCallback((errors: IErrorV3[]): JSX.Element => {
    if (errors == null || errors.length === 0) return <></>;
    return (
      <div className="alert alert-danger">
        {errors.map((err) => {
          // eslint-disable-next-line react/no-danger
          return <small dangerouslySetInnerHTML={{ __html: tWithOpt(err.message, err.args) }}></small>;
        })}
      </div>
    );
  }, [tWithOpt]);

  // wrap error elements which do not use dangerouslySetInnerHtml
  const generateSafelySetErrors = useCallback((errors: (IErrorV3 | IExternalAccountLoginError)[]): JSX.Element => {
    if (errors == null || errors.length === 0) return <></>;
    return (
      <ul className="alert alert-danger">
        {errors.map((err, index) => (
          <small className={index > 0 ? 'mt-1' : ''}>
            {tWithOpt(err.message, err.args)}
          </small>
        ))}
      </ul>
    );
  }, [tWithOpt]);

  const renderLocalOrLdapLoginForm = useCallback(() => {
    const { isLdapStrategySetup } = props;

    return (
      <>
        {/* !! - DO NOT DELETE HIDDEN ELEMENT - !! -- 7.12 ryoji-s */}
        {/* https://github.com/growilabs/growi/pull/7873 */}
        <div className="visually-hidden">
          <LoadingSpinner />
        </div>
        {/* !! - END OF HIDDEN ELEMENT - !! */}
        {isLdapSetupFailed && (
          <div className="alert alert-warning small">
            <strong><span className="material-symbols-outlined">info</span>{t('login.enabled_ldap_has_configuration_problem')}</strong><br />
            {/* eslint-disable-next-line react/no-danger */}
            <span dangerouslySetInnerHTML={{ __html: t('login.set_env_var_for_logs') }}></span>
          </div>
        )}

        <form role="form" onSubmit={handleLoginWithLocalSubmit} id="login-form">
          <div className="input-group">
            <label className="text-white opacity-75 d-flex align-items-center" htmlFor="tiUsernameForLogin">
              <span className="material-symbols-outlined" aria-label="Username or E-mail">person</span>
            </label>
            <input
              id="tiUsernameForLogin"
              type="text"
              className={`form-control rounded ms-2 ${isLdapStrategySetup ? 'ldap-space' : ''}`}
              data-testid="tiUsernameForLogin"
              placeholder="Username or E-mail"
              onChange={(e) => { setUsernameForLogin(e.target.value) }}
              name="usernameForLogin"
            />
            {isLdapStrategySetup && (
              <small className="badge text-bg-success input-ldap d-flex align-items-center">
                <span className="material-symbols-outlined">network_node</span>
                <span className="">LDAP</span>
              </small>
            )}

          </div>

          <div className="input-group">
            <label className="text-white opacity-75 d-flex align-items-center" htmlFor="tiPasswordForLogin">
              <span className="material-symbols-outlined" aria-label="Password">lock</span>
            </label>
            <input
              id="tiPasswordForLogin"
              type="password"
              className="form-control rounded ms-2"
              data-testid="tiPasswordForLogin"
              placeholder="Password"
              onChange={(e) => { setPasswordForLogin(e.target.value) }}
              name="passwordForLogin"
            />
          </div>

          <div className="input-group my-4">
            <button
              type="submit"
              className="btn btn-secondary btn-login col-7 mx-auto d-flex"
              data-testid="btnSubmitForLogin"
              disabled={isLoading}
            >
              <span>
                {isLoading ? (
                  <LoadingSpinner />
                ) : (
                  <span className="material-symbols-outlined" aria-label="Login">login</span>
                )}
              </span>
              <span className="flex-grow-1">{t('Sign in')}</span>
            </button>
          </div>
        </form>
      </>
    );
  }, [
    props, isLdapSetupFailed, t, handleLoginWithLocalSubmit, isLoading,
  ]);


  const renderExternalAuthLoginForm = useCallback(() => {
    const { enabledExternalAuthType } = props;

    if (enabledExternalAuthType == null) {
      return <></>;
    }

    return (
      <>
        <div className="mt-2">
          {enabledExternalAuthType.map(authType => <ExternalAuthButton authType={authType} />)}
        </div>
      </>
    );
  }, [props]);

  const resetRegisterErrors = useCallback(() => {
    if (registerErrors.length === 0) return;
    setRegisterErrors([]);
  }, [registerErrors.length]);

  const handleRegisterFormSubmit = useCallback(async(e, requestPath) => {
    e.preventDefault();
    setEmailForRegistrationOrder('');
    setIsSuccessToRagistration(false);
    setIsLoading(true);

    const registerForm = {
      username: usernameForRegister,
      name: nameForRegister,
      email: emailForRegister,
      password: passwordForRegister,
    };
    try {
      const res = await apiv3Post(requestPath, { registerForm });

      setIsSuccessToRagistration(true);
      resetRegisterErrors();

      const { redirectTo } = res.data;

      if (redirectTo != null) {
        router.push(redirectTo);
      }

      if (isEmailAuthenticationEnabled) {
        setEmailForRegistrationOrder(emailForRegister);
        return;
      }
    }
    catch (err) {
      // Execute if error exists
      if (err != null || err.length > 0) {
        setRegisterErrors(err);
      }
      setIsLoading(false);
    }
    return;
  }, [usernameForRegister, nameForRegister, emailForRegister, passwordForRegister, resetRegisterErrors, router, isEmailAuthenticationEnabled]);

  const switchForm = useCallback(() => {
    setIsRegistering(!isRegistering);
    resetLoginErrors();
    resetRegisterErrors();
  }, [isRegistering, resetLoginErrors, resetRegisterErrors]);

  const renderRegisterForm = useCallback(() => {
    let registerAction = '/register';

    let submitText = t('Sign up');
    if (isEmailAuthenticationEnabled) {
      registerAction = '/user-activation/register';
      submitText = t('page_register.send_email');
    }

    return (
      <React.Fragment>
        {registrationMode === RegistrationMode.RESTRICTED && (
          <p className="alert alert-warning">
            {t('page_register.notice.restricted')}
            <br />
            {t('page_register.notice.restricted_defail')}
          </p>
        )}
        {(!isMailerSetup && isEmailAuthenticationEnabled) && (
          <p className="alert alert-danger">
            <span>{t('commons:alert.please_enable_mailer')}</span>
          </p>
        )}

        {
          registerErrors != null && registerErrors.length > 0 && (
            <p className="alert alert-danger">
              {registerErrors.map(err => (
                <span>
                  {tWithOpt(err.message, err.args)}<br />
                </span>
              ))}
            </p>
          )
        }

        {
          (isEmailAuthenticationEnabled && isSuccessToRagistration) && (
            <p className="alert alert-success">
              <span>{t('message.successfully_send_email_auth', { email: emailForRegistrationOrder })}</span>
            </p>
          )
        }

        <form role="form" onSubmit={e => handleRegisterFormSubmit(e, registerAction)} id="register-form">

          {!isEmailAuthenticationEnabled && (
            <div>
              <div className="input-group" id="input-group-username">
                <span className="text-white opacity-75 d-flex align-items-center">
                  <span className="material-symbols-outlined">person</span>
                </span>
                {/* username */}
                <input
                  type="text"
                  className="form-control rounded ms-2"
                  onChange={(e) => { setUsernameForRegister(e.target.value) }}
                  placeholder={t('User ID')}
                  name="username"
                  defaultValue={props.username}
                  required
                />
              </div>
              <p className="form-text text-danger">
                <span id="help-block-username"></span>
              </p>
              <div className="input-group">
                <span className="text-white opacity-75 d-flex align-items-center">
                  <span className="material-symbols-outlined">sell</span>
                </span>
                {/* name */}
                <input
                  type="text"
                  className="form-control rounded ms-2"
                  onChange={(e) => { setNameForRegister(e.target.value) }}
                  placeholder={t('Name')}
                  name="name"
                  defaultValue={props.name}
                  required
                />
              </div>
            </div>
          )}

          <div className="input-group">
            <span className="text-white opacity-75 d-flex align-items-center">
              <span className="material-symbols-outlined">mail</span>
            </span>
            {/* email */}
            <input
              type="email"
              disabled={!isMailerSetup && isEmailAuthenticationEnabled}
              className="form-control rounded ms-2"
              onChange={(e) => { setEmailForRegister(e.target.value) }}
              placeholder={t('Email')}
              name="email"
              defaultValue={props.email}
              required
            />
          </div>

          {registrationWhitelist.length > 0 && (
            <>
              <p className="form-text">{t('page_register.form_help.email')}</p>
              <ul>
                {registrationWhitelist.map((elem) => {
                  return (
                    <li key={elem}>
                      <code>{elem}</code>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {!isEmailAuthenticationEnabled && (
            <div>
              <div className="input-group">
                <span className="text-white opacity-75 d-flex align-items-center">
                  <span className="material-symbols-outlined">lock</span>
                </span>
                {/* Password */}
                <input
                  type="password"
                  className="form-control rounded ms-2"
                  onChange={(e) => { setPasswordForRegister(e.target.value) }}
                  placeholder={t('Password')}
                  name="password"
                  required
                  minLength={minPasswordLength}
                />
              </div>
            </div>
          )}

          {/* Sign up button (submit) */}
          <div className="input-group justify-content-center my-4">
            <button
              type="submit"
              className="btn btn-secondary btn-register d-flex col-7"
              disabled={(!isMailerSetup && isEmailAuthenticationEnabled) || isLoading}
            >
              <span>
                {isLoading ? (
                  <LoadingSpinner />
                ) : (
                  <span className="material-symbols-outlined">person_add</span>
                )}
              </span>
              <span className="flex-grow-1">{submitText}</span>
            </button>
          </div>
        </form>

        <div className="row">
          <div className="text-end col-12 mb-5">
            <a
              href="#login"
              className="btn btn-sm btn-secondary btn-function col-10 col-sm-9 mx-auto py-1 d-flex"
              style={{ pointerEvents: isLoading ? 'none' : undefined }}
              onClick={switchForm}
            >
              <span className="material-symbols-outlined fs-5">login</span>
              <span className="flex-grow-1">{t('Sign in is here')}</span>
            </a>
          </div>
        </div>
      </React.Fragment>
    );
  }, [
    t, isEmailAuthenticationEnabled, registrationMode, isMailerSetup, registerErrors, isSuccessToRagistration, emailForRegistrationOrder,
    props.username, props.name, props.email, registrationWhitelist, minPasswordLength, isLoading, switchForm, tWithOpt, handleRegisterFormSubmit,
  ]);

  if (registrationMode === RegistrationMode.RESTRICTED && isSuccessToRagistration && !isEmailAuthenticationEnabled) {
    return <CompleteUserRegistration />;
  }

  return (
    <div className={moduleClass}>
      <div className="nologin-dialog mx-auto rounded-4 rounded-top-0" id="nologin-dialog" data-testid="login-form">
        <div className="row mx-0">
          <div className="col-12 px-md-4 pb-5">
            <ReactCardFlip isFlipped={isRegistering} flipDirection="horizontal" cardZIndex="3">
              <div className="front">
                {/* Error display section - always shown regardless of login method configuration */}
                {(() => {
                  // separate login errors into two arrays based on error code
                  const [loginErrorListForDangerouslySetInnerHTML, loginErrorList] = separateErrorsBasedOnErrorCode(loginErrors);
                  // Generate login error elements using dangerouslySetInnerHTML
                  const loginErrorElementWithDangerouslySetInnerHTML = generateDangerouslySetErrors(loginErrorListForDangerouslySetInnerHTML);
                  // Generate login error elements - prioritize loginErrorList, fallback to externalAccountLoginError
                  const loginErrorElement = (loginErrorList ?? []).length > 0
                    ? generateSafelySetErrors(loginErrorList)
                    : generateSafelySetErrors(props.externalAccountLoginError != null ? [props.externalAccountLoginError] : []);

                  return (
                    <>
                      {loginErrorElementWithDangerouslySetInnerHTML}
                      {loginErrorElement}
                    </>
                  );
                })()}

                {isLocalOrLdapStrategiesEnabled && renderLocalOrLdapLoginForm()}
                {isLocalOrLdapStrategiesEnabled && isSomeExternalAuthEnabled && (
                  <div className="text-center text-line d-flex align-items-center mb-3">
                    <p className="text-white mb-0">{t('or')}</p>
                  </div>
                )}
                {isSomeExternalAuthEnabled && renderExternalAuthLoginForm()}
                {isLocalOrLdapStrategiesEnabled && isPasswordResetEnabled && (
                  <div className="mt-4">
                    <a
                      href="/forgot-password"
                      className="btn btn-sm btn-secondary btn-function col-10 col-sm-9 mx-auto py-1 d-flex"
                      style={{ pointerEvents: isLoading ? 'none' : 'auto' }}
                    >
                      <span className="material-symbols-outlined">vpn_key</span>
                      <span className="flex-grow-1">{t('forgot_password.forgot_password')}</span>
                    </a>
                  </div>
                )}
                {/* Sign up link */}
                {isRegistrationEnabled && (
                  <div className="mt-2">
                    <a
                      href="#register"
                      className="btn btn-sm btn-secondary btn-function col-10 col-sm-9 mx-auto py-1 d-flex"
                      style={{ pointerEvents: isLoading ? 'none' : 'auto' }}
                      onClick={switchForm}
                    >
                      <span className="material-symbols-outlined">person_add</span>
                      <span className="flex-grow-1">{t('Sign up is here')}</span>
                    </a>
                  </div>
                )}
              </div>
              <div className="back">
                {/* Register form for /login#register */}
                {isRegistrationEnabled && renderRegisterForm()}
              </div>
            </ReactCardFlip>
          </div>
        </div>
        <a href="https://growi.org" className="link-growi-org ps-3">
          <span className="growi">GROWI</span><span className="org">.org</span>
        </a>
      </div>
    </div>
  );

};
