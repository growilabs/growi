import type { FC } from 'react';
import { useCallback } from 'react';

import { apiv3Put } from '~/client/util/apiv3-client.js';
import { ExternalGroupProviderType } from '~/features/external-user-group/interfaces/external-user-group.js';

import { KeycloakGroupSyncSettingsForm } from './KeycloakGroupSyncSettingsForm.js';
import { SyncExecution } from './SyncExecution.js';

export const KeycloakGroupManagement: FC = () => {
  const requestSyncAPI = useCallback(async () => {
    await apiv3Put('/external-user-groups/keycloak/sync');
  }, []);

  return (
    <>
      <KeycloakGroupSyncSettingsForm />
      <SyncExecution
        provider={ExternalGroupProviderType.keycloak}
        requestSyncAPI={requestSyncAPI}
      />
    </>
  );
};
