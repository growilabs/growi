import type { RelationSettings } from '@growi/chat';

export interface EncryptionStatus {
  readonly configured: boolean;
  readonly reason?: 'unset' | 'invalid-key' | 'invalid-generation';
}

export interface AdminRelationListItem {
  readonly relationId: string;
  readonly platform: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly label: string | null;
  readonly state: 'active' | 'unpaired';
  readonly createdAt: string;
  readonly unpairedAt: string | null;
}

export interface RelationSettingsView {
  readonly settings: RelationSettings;
  readonly version: number;
}

export type SaveSettingsOutcome = {
  readonly status: 'saved';
  readonly version: number;
  readonly push:
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: string };
};
