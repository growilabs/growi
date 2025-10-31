import type { FC } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiv3Get, apiv3Put } from '~/client/util/apiv3-client';
import { toastError } from '~/client/util/toastr';
import { ExternalGroupProviderType } from '~/features/external-user-group/interfaces/external-user-group';

import { LdapGroupSyncSettingsForm } from './LdapGroupSyncSettingsForm';
import { SyncExecution } from './SyncExecution';

export const LdapGroupManagement: FC = () => {
  const [isUserBind, setIsUserBind] = useState(false);
  const { t } = useTranslation('admin');

  useEffect(() => {
    const getIsUserBind = async () => {
      try {
        const response = await apiv3Get('/security-setting/');
        const { ldapAuth } = response.data.securityParams;
        setIsUserBind(ldapAuth.isUserBind);
      } catch (e) {
        toastError(e);
      }
    };
    getIsUserBind();
  }, []);

  const requestSyncAPI = useCallback(
    async (e) => {
      if (isUserBind) {
        const password = e.target.password?.value;
        await apiv3Put('/external-user-groups/ldap/sync', { password });
      } else {
        await apiv3Put('/external-user-groups/ldap/sync');
      }
    },
    [isUserBind],
  );

  // biome-ignore lint/correctness/noNestedComponentDefinitions: ignore
  const AdditionalForm = (): JSX.Element => {
    return isUserBind ? (
      <div className="row form-group">
        <label
          htmlFor="ldapGroupSyncPassword"
          className="text-left text-md-right col-md-3 col-form-label"
        >
          {t('external_user_group.ldap.password')}
        </label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="password"
            name="password"
            id="ldapGroupSyncPassword"
          />
          <p className="form-text text-muted">
            <small>{t('external_user_group.ldap.password_detail')}</small>
          </p>
        </div>
      </div>
    ) : (
      <></>
    );
  };

  return (
    <>
      <LdapGroupSyncSettingsForm />
      <SyncExecution
        provider={ExternalGroupProviderType.ldap}
        requestSyncAPI={requestSyncAPI}
        AdditionalForm={AdditionalForm}
      />
    </>
  );
};
