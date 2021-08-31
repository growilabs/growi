import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'unstated';
import { I18nextProvider } from 'react-i18next';

import { i18nFactory } from './util/i18n';

import AppContainer from '~/client/services/AppContainer';

import InstallerForm from '../components/InstallerForm';
import LoginForm from '../components/LoginForm';
import PasswordResetRequestForm from '../components/PasswordResetRequestForm';
import PasswordResetExecutionForm from '../components/PasswordResetExecutionForm';

const i18n = i18nFactory();

// render InstallerForm
const installerFormElem = document.getElementById('installer-form');
if (installerFormElem) {
  const userName = installerFormElem.dataset.userName;
  const name = installerFormElem.dataset.name;
  const email = installerFormElem.dataset.email;
  const csrf = installerFormElem.dataset.csrf;
  ReactDOM.render(
    <I18nextProvider i18n={i18n}>
      <InstallerForm userName={userName} name={name} email={email} csrf={csrf} />
    </I18nextProvider>,
    installerFormElem,
  );
}

// render loginForm
const loginFormElem = document.getElementById('login-form');
if (loginFormElem) {
  const appContainer = new AppContainer();
  appContainer.initApp();

  const username = loginFormElem.dataset.username;
  const name = loginFormElem.dataset.name;
  const email = loginFormElem.dataset.email;
  const isRegistrationEnabled = loginFormElem.dataset.isRegistrationEnabled === 'true';
  const registrationMode = loginFormElem.dataset.registrationMode;
  const isPasswordResetEnabled = loginFormElem.dataset.isPasswordResetEnabled === 'true';


  let registrationWhiteList = loginFormElem.dataset.registrationWhiteList;
  registrationWhiteList = registrationWhiteList.length > 0
    ? registrationWhiteList = loginFormElem.dataset.registrationWhiteList.split(',')
    : registrationWhiteList = [];


  const isLocalStrategySetup = loginFormElem.dataset.isLocalStrategySetup === 'true';
  const isLdapStrategySetup = loginFormElem.dataset.isLdapStrategySetup === 'true';
  const objOfIsExternalAuthEnableds = {
    google: loginFormElem.dataset.isGoogleAuthEnabled === 'true',
    github: loginFormElem.dataset.isGithubAuthEnabled === 'true',
    facebook: loginFormElem.dataset.isFacebookAuthEnabled === 'true',
    twitter: loginFormElem.dataset.isTwitterAuthEnabled === 'true',
    saml: loginFormElem.dataset.isSamlAuthEnabled === 'true',
    oidc: loginFormElem.dataset.isOidcAuthEnabled === 'true',
    basic: loginFormElem.dataset.isBasicAuthEnabled === 'true',
  };

  ReactDOM.render(
    <I18nextProvider i18n={i18n}>
      <Provider inject={[appContainer]}>
        <LoginForm
          username={username}
          name={name}
          email={email}
          isRegistrationEnabled={isRegistrationEnabled}
          registrationMode={registrationMode}
          registrationWhiteList={registrationWhiteList}
          isPasswordResetEnabled={isPasswordResetEnabled}
          isLocalStrategySetup={isLocalStrategySetup}
          isLdapStrategySetup={isLdapStrategySetup}
          objOfIsExternalAuthEnableds={objOfIsExternalAuthEnableds}
        />
      </Provider>
    </I18nextProvider>,
    loginFormElem,
  );
}

// render PasswordResetRequestForm
const passwordResetRequestFormElem = document.getElementById('password-reset-request-form');
const appContainer = new AppContainer();
appContainer.initApp();
if (passwordResetRequestFormElem) {

  ReactDOM.render(
    <I18nextProvider i18n={i18n}>
      <Provider inject={[appContainer]}>
        <PasswordResetRequestForm />
      </Provider>
    </I18nextProvider>,
    passwordResetRequestFormElem,
  );
}

// render PasswordResetExecutionForm
const passwordResetExecutionFormElem = document.getElementById('password-reset-execution-form');
if (passwordResetExecutionFormElem) {

  ReactDOM.render(
    <I18nextProvider i18n={i18n}>
      <Provider inject={[appContainer]}>
        <PasswordResetExecutionForm />
      </Provider>
    </I18nextProvider>,
    passwordResetExecutionFormElem,
  );
}
