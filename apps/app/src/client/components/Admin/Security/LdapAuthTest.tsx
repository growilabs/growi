import React, { useState, type JSX } from 'react';

import { useTranslation } from 'next-i18next';

import { apiPost } from '~/client/util/apiv1-client';
import { toastSuccess, toastError } from '~/client/util/toastr';
import type { IResTestLdap } from '~/interfaces/ldap';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:security:AdminLdapSecurityContainer');

type LdapAuthTestProps = {
  username: string,
  password: string,
  onChangeUsername: (username: string) => void,
  onChangePassword: (password: string) => void,
}

export const LdapAuthTest = (props: LdapAuthTestProps): JSX.Element => {
  const {
    username, password, onChangeUsername, onChangePassword,
  } = props;
  const { t } = useTranslation();
  const [logs, setLogs] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  /**
   * add logs
   */
  const addLogs = (log) => {
    const newLog = `${new Date()} - ${log}\n\n`;
    setLogs(`${newLog}${logs}`);
  };

  /**
   * Test ldap auth
   */
  const testLdapCredentials = async() => {
    try {
      const response = await apiPost<IResTestLdap>('/login/testLdap', {
        loginForm: {
          username,
          password,
        },
      });

      const {
        err, message, status, ldapConfiguration, ldapAccountInfo,
      } = response;

      // add logs
      if (err) {
        toastError(err);
        addLogs(err);
      }

      if (status === 'warning') {
        addLogs(message);
        setErrorMessage(message);
        setSuccessMessage('');
      }

      if (status === 'success') {
        toastSuccess(message);
        setSuccessMessage(message);
        setErrorMessage('');
      }

      if (ldapConfiguration) {
        const prettified = JSON.stringify(ldapConfiguration.server, undefined, 4);
        addLogs(`LDAP Configuration : ${prettified}`);
      }
      if (ldapAccountInfo) {
        const prettified = JSON.stringify(ldapAccountInfo, undefined, 4);
        addLogs(`Retrieved LDAP Account : ${prettified}`);
      }

    }
    // Catch server communication error
    catch (err) {
      toastError(err);
      logger.error(err);
    }
  };


  return (
    <React.Fragment>
      {successMessage !== '' && <div className="alert alert-success">{successMessage}</div>}
      {errorMessage !== '' && <div className="alert alert-warning">{errorMessage}</div>}
      <div className="row mt-3">
        <label htmlFor="username" className="col-3 col-form-label text-end">{t('username')}</label>
        <div className="col-6">
          <input
            className="form-control"
            name="username"
            value={username}
            onChange={(e) => { onChangeUsername(e.target.value) }}
            autoComplete="off"
          />
        </div>
      </div>
      <div className="row mt-3">
        <label htmlFor="password" className="col-3 col-form-label text-end">{t('Password')}</label>
        <div className="col-6">
          <input
            className="form-control"
            type="password"
            name="password"
            value={password}
            onChange={(e) => { onChangePassword(e.target.value) }}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="mt-4">
        <label className="form-label"><h5>Logs</h5></label>
        <textarea id="taLogs" className="col form-control" rows={4} value={logs} readOnly />
      </div>

      <div className="mt-4">
        <button type="button" className="btn btn-outline-secondary offset-5 col-2" onClick={testLdapCredentials}>Test</button>
      </div>
    </React.Fragment>

  );
};
