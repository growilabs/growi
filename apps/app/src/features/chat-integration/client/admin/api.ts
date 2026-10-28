import type { CapabilityReport, ConnectionStatusView } from '@growi/chat';

import { apiv3Get } from '~/client/util/apiv3-client';

import type {
  AdminRelationListItem,
  EncryptionStatus,
  RelationSettingsView,
} from './types';

export const fetchEncryptionStatus = async (): Promise<EncryptionStatus> => {
  const res = await apiv3Get<EncryptionStatus>(
    '/chat-integration/admin/encryption-status',
  );
  return res.data;
};

export const fetchRelations = async (): Promise<AdminRelationListItem[]> => {
  const res = await apiv3Get<{ relations: AdminRelationListItem[] }>(
    '/chat-integration/admin/relations',
  );
  return res.data.relations;
};

export const fetchCapabilitiesFor = (
  relationId: string,
): (() => Promise<CapabilityReport>) => {
  return async () => {
    const res = await apiv3Get<CapabilityReport>(
      `/chat-integration/admin/relations/${relationId}/capabilities`,
    );
    return res.data;
  };
};

export const fetchConnectionStatusFor = (
  relationId: string,
): (() => Promise<ConnectionStatusView>) => {
  return async () => {
    const res = await apiv3Get<ConnectionStatusView>(
      `/chat-integration/admin/relations/${relationId}/connection-status`,
    );
    return res.data;
  };
};

export const fetchSettingsFor = (
  relationId: string,
): (() => Promise<RelationSettingsView>) => {
  return async () => {
    const res = await apiv3Get<RelationSettingsView>(
      `/chat-integration/admin/relations/${relationId}/settings`,
    );
    return res.data;
  };
};
