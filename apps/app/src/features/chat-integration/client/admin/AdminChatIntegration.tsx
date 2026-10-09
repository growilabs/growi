// Task 9.1's admin screen: shows every relation this GROWI has paired with,
// what each connected service can actually do (Requirement 1.3), each
// active relation's live connection health (Requirement 1.4), and lets an
// administrator start a new pairing -- unless the encryption key this
// feature needs to store a private key is not configured (design.md
// "秘密鍵の暗号化...未設定ならペアリングを始められない").
//
// Task 9.2 adds the per-relation channel-permission editor (Requirements
// 11.1/11.2/11.4): what an administrator saves here is written
// transactionally with a version bump and then pushed to the proxy. A push
// that fails is reported as a SAVE THAT SUCCEEDED, because it is one -- the
// proxy fetches the settings itself through `settings-pull`.
//
// An active relation also offers the disconnect (Requirement 9.7) -- see
// `UnpairButton`; it is the only place in the product from which a relation
// can be marked `unpaired`, which the 90-day sweep and a re-pairing's
// account-link inheritance both depend on.
//
// Follows this feature's own client convention (see `MyChatAccountLinks.tsx`
// and `AccountLinkApproval.tsx`): plain hooks + `~/client/util/apiv3-client`
// directly, no `~/stores/*` entry, English-first UI text (translation is a
// separate, later task -- this feature's own precedent already ships this
// way, and blocking a brand-new admin screen on i18n key authoring would
// gate a working feature on unrelated work).
//
// CRITICAL: the "what can this service do" section renders `CapabilityReport`
// GENERICALLY -- it iterates `report.platforms[].capabilities[]` and prints
// whatever fields come back, with no per-platform or per-capability branch.
// Do NOT add a switch/if that special-cases a capability name or platform
// here: the proxy is the single source of truth for what each service can
// do (task 9.1's own warning against deciding this independently).

import { type JSX, useCallback, useId, useState } from 'react';
import {
  type CapabilityReport,
  COMMAND_NAMES,
  type CommandName,
  type ConnectionStatusView,
  type RelationSettings,
} from '@growi/chat';
import useSWR from 'swr';

import { apiv3Get, apiv3Post } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';

import { NotificationDestinationsSection } from './NotificationDestinationsSection';

// ============================================================================
// Types
// ============================================================================

interface EncryptionStatus {
  readonly configured: boolean;
  readonly reason?: 'unset' | 'invalid-key' | 'invalid-generation';
}

interface AdminRelationListItem {
  readonly relationId: string;
  readonly platform: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly label: string | null;
  readonly state: 'active' | 'unpaired';
  readonly createdAt: string;
  readonly unpairedAt: string | null;
}

interface RelationSettingsView {
  readonly settings: RelationSettings;
  readonly version: number;
}

type SaveSettingsOutcome = {
  readonly status: 'saved';
  readonly version: number;
  readonly push:
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: string };
};

type PairingOutcome =
  | { readonly status: 'paired'; readonly relationId: string }
  | { readonly status: 'relation-already-known'; readonly relationId: string }
  | { readonly status: 'already-paired'; readonly detail: string }
  | { readonly status: 'code-expired' }
  | { readonly status: 'ownership-unverified'; readonly detail: string }
  | { readonly status: 'call-failed'; readonly reason: string }
  | { readonly status: 'key-encryption-unconfigured' };

// ============================================================================
// Fetchers
// ============================================================================

const fetchEncryptionStatus = async (): Promise<EncryptionStatus> => {
  const res = await apiv3Get<EncryptionStatus>(
    '/chat-integration/admin/encryption-status',
  );
  return res.data;
};

const fetchRelations = async (): Promise<AdminRelationListItem[]> => {
  const res = await apiv3Get<{ relations: AdminRelationListItem[] }>(
    '/chat-integration/admin/relations',
  );
  return res.data.relations;
};

const fetchCapabilitiesFor = (
  relationId: string,
): (() => Promise<CapabilityReport>) => {
  return async () => {
    const res = await apiv3Get<CapabilityReport>(
      `/chat-integration/admin/relations/${relationId}/capabilities`,
    );
    return res.data;
  };
};

const fetchConnectionStatusFor = (
  relationId: string,
): (() => Promise<ConnectionStatusView>) => {
  return async () => {
    const res = await apiv3Get<ConnectionStatusView>(
      `/chat-integration/admin/relations/${relationId}/connection-status`,
    );
    return res.data;
  };
};

const fetchSettingsFor = (
  relationId: string,
): (() => Promise<RelationSettingsView>) => {
  return async () => {
    const res = await apiv3Get<RelationSettingsView>(
      `/chat-integration/admin/relations/${relationId}/settings`,
    );
    return res.data;
  };
};

// ============================================================================
// Sub-sections
// ============================================================================

/**
 * Renders `CapabilityReport` generically -- every platform, every
 * capability, whatever `level`/`substitute` the proxy reports. No field is
 * assumed, dropped, or branched on by name.
 */
const CapabilityReportTable = ({
  report,
}: {
  report: CapabilityReport;
}): JSX.Element => (
  <table className="table table-sm table-bordered mb-0">
    <thead>
      <tr>
        <th>Platform</th>
        <th>Capability</th>
        <th>Level</th>
        <th>Substitute</th>
      </tr>
    </thead>
    <tbody>
      {report.platforms.flatMap((platformEntry) =>
        platformEntry.capabilities.map((cap) => (
          <tr
            key={`${platformEntry.platform}-${cap.capability}`}
            data-testid="grw-chat-integration-capability-row"
          >
            <td>{platformEntry.platform}</td>
            <td>{cap.capability}</td>
            <td>{cap.level}</td>
            <td>{cap.substitute ?? '—'}</td>
          </tr>
        )),
      )}
    </tbody>
  </table>
);

// ============================================================================
// Channel permissions (task 9.2)
// ============================================================================

/**
 * What an administrator can say about one command. `'unset'` is not a wire
 * value: it means "no row for this command", which the protocol's own
 * judgement treats as its default (a write command is denied, a read command
 * is allowed). It has to stay expressible, otherwise saving this screen once
 * would silently turn every command that was merely never configured into an
 * explicit rule.
 */
type ScopeChoice = 'unset' | 'all' | 'none' | 'listed';

const SCOPE_LABELS: Readonly<Record<ScopeChoice, string>> = {
  unset: 'Not configured (protocol default)',
  all: 'Every channel',
  none: 'No channel',
  listed: 'Only these channels',
};

interface CommandFormState {
  readonly scope: ScopeChoice;
  /** Free text while editing; split into channel ids on save. */
  readonly channelIds: string;
}

const ALL_COMMAND_NAMES: ReadonlyArray<CommandName> = Object.values(
  COMMAND_NAMES,
) as ReadonlyArray<CommandName>;

const toFormState = (
  channelPermissions: RelationSettings['channelPermissions'],
): Record<CommandName, CommandFormState> => {
  const byCommand = new Map(
    channelPermissions.map((row) => [row.commandName, row.allowedChannels]),
  );
  const entries = ALL_COMMAND_NAMES.map(
    (commandName): [CommandName, CommandFormState] => {
      const allowedChannels = byCommand.get(commandName);
      if (allowedChannels == null) {
        return [commandName, { scope: 'unset', channelIds: '' }];
      }
      if (allowedChannels === 'all' || allowedChannels === 'none') {
        return [commandName, { scope: allowedChannels, channelIds: '' }];
      }
      return [
        commandName,
        { scope: 'listed', channelIds: allowedChannels.join(', ') },
      ];
    },
  );
  return Object.fromEntries(entries) as Record<CommandName, CommandFormState>;
};

/** Channel IDS, never names -- a name can be changed by anyone in the chat service. */
const splitChannelIds = (raw: string): string[] =>
  raw
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

const toChannelPermissions = (
  form: Record<CommandName, CommandFormState>,
): RelationSettings['channelPermissions'] =>
  ALL_COMMAND_NAMES.flatMap((commandName) => {
    const { scope, channelIds } = form[commandName];
    if (scope === 'unset') {
      return [];
    }
    return [
      {
        commandName,
        allowedChannels:
          scope === 'listed' ? splitChannelIds(channelIds) : scope,
      },
    ];
  });

const describeSaveOutcome = (outcome: SaveSettingsOutcome): string =>
  outcome.push.ok
    ? `Saved (version ${outcome.version}) and pushed to the proxy.`
    : `Saved (version ${outcome.version}), but the proxy could not be told yet (${outcome.push.reason}). The proxy will fetch these settings itself.`;

/**
 * Editor for one relation's channel permissions.
 *
 * Channels are entered as ids on purpose -- a name can be changed by
 * anyone in the chat service, so a permission written against one would
 * silently stop applying. Task 9.3 built the pick-from-the-channel-list
 * form for NOTIFICATION DESTINATIONS
 * (`NotificationDestinationsSection.tsx`); this permission editor still
 * takes ids as text, which is a usability gap rather than a correctness
 * one (what is stored and matched is an id either way).
 */
const ChannelPermissionsForm = ({
  relationId,
  initialPermissions,
  version,
  onSaved,
}: {
  relationId: string;
  initialPermissions: RelationSettings['channelPermissions'];
  version: number;
  onSaved: () => void;
}): JSX.Element => {
  const [form, setForm] = useState<Record<CommandName, CommandFormState>>(() =>
    toFormState(initialPermissions),
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleScopeChange = useCallback(
    (commandName: CommandName) => (e: React.ChangeEvent<HTMLSelectElement>) => {
      const scope = e.target.value as ScopeChoice;
      setForm((prev) => ({
        ...prev,
        [commandName]: { ...prev[commandName], scope },
      }));
    },
    [],
  );

  const handleChannelIdsChange = useCallback(
    (commandName: CommandName) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const channelIds = e.target.value;
      setForm((prev) => ({
        ...prev,
        [commandName]: { ...prev[commandName], channelIds },
      }));
    },
    [],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setIsSaving(true);
      try {
        const res = await apiv3Post<SaveSettingsOutcome>(
          `/chat-integration/admin/relations/${relationId}/settings`,
          { channelPermissions: toChannelPermissions(form) },
        );
        toastSuccess(describeSaveOutcome(res.data));
        onSaved();
      } catch (err) {
        toastError(err);
      } finally {
        setIsSaving(false);
      }
    },
    [form, onSaved, relationId],
  );

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="grw-chat-integration-permissions-form"
    >
      <p className="text-muted mb-2">Settings version: {version}</p>
      {ALL_COMMAND_NAMES.map((commandName) => (
        <div
          className="row align-items-center mb-2"
          key={commandName}
          data-testid="grw-chat-integration-permission-row"
        >
          <div className="col-3">
            <label
              className="form-label mb-0"
              htmlFor={`${relationId}-${commandName}-scope`}
            >
              {commandName}
            </label>
          </div>
          <div className="col-4">
            <select
              id={`${relationId}-${commandName}-scope`}
              className="form-select"
              value={form[commandName].scope}
              onChange={handleScopeChange(commandName)}
            >
              {(Object.keys(SCOPE_LABELS) as ScopeChoice[]).map((scope) => (
                <option key={scope} value={scope}>
                  {SCOPE_LABELS[scope]}
                </option>
              ))}
            </select>
          </div>
          <div className="col-5">
            {form[commandName].scope === 'listed' && (
              <input
                type="text"
                className="form-control"
                aria-label={`Channel ids for ${commandName}`}
                placeholder="C0123ABCDEF, C0456GHIJKL"
                value={form[commandName].channelIds}
                onChange={handleChannelIdsChange(commandName)}
              />
            )}
          </div>
        </div>
      ))}
      <button type="submit" className="btn btn-primary" disabled={isSaving}>
        {isSaving ? 'Saving…' : 'Save channel permissions'}
      </button>
    </form>
  );
};

const ChannelPermissionsSection = ({
  relationId,
}: {
  relationId: string;
}): JSX.Element => {
  const {
    data,
    error,
    mutate: mutateSettings,
  } = useSWR<RelationSettingsView>(
    `chat-integration-admin-settings-${relationId}`,
    fetchSettingsFor(relationId),
  );

  const handleSaved = useCallback(() => {
    mutateSettings();
  }, [mutateSettings]);

  return (
    <div className="mt-3">
      <span className="fw-bold">Channel permissions:</span>
      {error != null && (
        <p className="text-danger mb-0">Failed to load channel permissions</p>
      )}
      {data != null && (
        // Re-keyed on the version so that a save (which bumps the version)
        // rebuilds the form from what the server now holds, rather than
        // leaving the previous edit state in place.
        <ChannelPermissionsForm
          key={data.version}
          relationId={relationId}
          initialPermissions={data.settings.channelPermissions}
          version={data.version}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
};

// ============================================================================
// Disconnecting a workspace (Requirement 9.7)
// ============================================================================

/**
 * The "disconnect this workspace" control -- the only way an administrator
 * can reach `unpairRelation`, which deletes this relation's keys, channel
 * permissions and notification destinations and marks the relation
 * `unpaired`.
 *
 * The confirmation is a second click on this same row rather than
 * `window.confirm`: it is the one destructive action on this screen, and an
 * accidental click on it cannot be undone from here (re-pairing needs a
 * fresh registration code from the proxy).
 */
const UnpairButton = ({
  relationId,
  onUnpaired,
}: {
  relationId: string;
  onUnpaired: () => void;
}): JSX.Element => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAsk = useCallback(() => setIsConfirming(true), []);
  const handleCancel = useCallback(() => setIsConfirming(false), []);

  const handleConfirm = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await apiv3Post(
        `/chat-integration/admin/relations/${relationId}/unpair`,
        {},
      );
      toastSuccess(
        'Disconnected. This workspace’s keys, channel permissions and notification destinations have been removed.',
      );
      setIsConfirming(false);
      onUnpaired();
    } catch (err) {
      toastError(err);
    } finally {
      setIsSubmitting(false);
    }
  }, [onUnpaired, relationId]);

  if (!isConfirming) {
    return (
      <button
        type="button"
        className="btn btn-outline-danger btn-sm"
        onClick={handleAsk}
      >
        Disconnect
      </button>
    );
  }

  return (
    <div data-testid="grw-chat-integration-unpair-confirm">
      <p className="text-danger mb-2">
        Disconnecting removes this workspace’s keys, channel permissions and
        notification destinations. Reconnecting needs a new registration code.
      </p>
      <button
        type="button"
        className="btn btn-danger btn-sm me-2"
        onClick={handleConfirm}
        disabled={isSubmitting}
      >
        {isSubmitting ? 'Disconnecting…' : 'Yes, disconnect'}
      </button>
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm"
        onClick={handleCancel}
        disabled={isSubmitting}
      >
        Cancel
      </button>
    </div>
  );
};

/** One relation's row: static info plus, for an active relation, live capabilities + connection status. */
const RelationRow = ({
  relation,
  onUnpaired,
}: {
  relation: AdminRelationListItem;
  onUnpaired: () => void;
}): JSX.Element => {
  const isActive = relation.state === 'active';

  const { data: capabilities, error: capabilitiesError } =
    useSWR<CapabilityReport>(
      isActive
        ? `chat-integration-admin-capabilities-${relation.relationId}`
        : null,
      isActive ? fetchCapabilitiesFor(relation.relationId) : null,
    );

  const { data: connectionStatus, error: connectionStatusError } =
    useSWR<ConnectionStatusView>(
      isActive
        ? `chat-integration-admin-connection-status-${relation.relationId}`
        : null,
      isActive ? fetchConnectionStatusFor(relation.relationId) : null,
      { refreshInterval: 15000 },
    );

  return (
    <div
      className="border rounded p-3 mb-3"
      data-testid="grw-chat-integration-relation-row"
    >
      <div className="d-flex justify-content-between align-items-center mb-2">
        <div>
          <strong>{relation.label ?? relation.workspaceName}</strong>{' '}
          <span className="text-muted">({relation.platform})</span>
        </div>
        <span className={`badge ${isActive ? 'bg-success' : 'bg-secondary'}`}>
          {relation.state}
        </span>
      </div>

      {isActive && (
        <div className="mb-2">
          <span className="fw-bold me-2">Connection:</span>
          {connectionStatusError != null && (
            <span className="text-danger">
              Failed to load connection status
            </span>
          )}
          {connectionStatus != null && (
            <span data-testid="grw-chat-integration-connection-health">
              {connectionStatus.health}
            </span>
          )}
        </div>
      )}

      {isActive && (
        <div>
          <span className="fw-bold">What this service can do:</span>
          {capabilitiesError != null && (
            <p className="text-danger mb-0">Failed to load capabilities</p>
          )}
          {capabilities != null && (
            <CapabilityReportTable report={capabilities} />
          )}
        </div>
      )}

      {isActive && (
        <ChannelPermissionsSection relationId={relation.relationId} />
      )}

      {isActive && (
        <NotificationDestinationsSection relationId={relation.relationId} />
      )}

      {isActive && (
        <div className="mt-3 pt-3 border-top">
          <UnpairButton
            relationId={relation.relationId}
            onUnpaired={onUnpaired}
          />
        </div>
      )}
    </div>
  );
};

interface PairingFormState {
  readonly registrationCode: string;
  readonly proxyUri: string;
  readonly growiUri: string;
  readonly growiLabel: string;
}

const EMPTY_PAIRING_FORM: PairingFormState = {
  registrationCode: '',
  proxyUri: '',
  growiUri: '',
  growiLabel: '',
};

const describePairingOutcome = (outcome: PairingOutcome): string => {
  switch (outcome.status) {
    case 'paired':
      return `Paired successfully (relation: ${outcome.relationId}).`;
    case 'relation-already-known':
      return 'This proxy already returned a relation this GROWI already has -- pairing was not established.';
    case 'already-paired':
      return `The proxy refused: ${outcome.detail}`;
    case 'code-expired':
      return 'The registration code has expired.';
    case 'ownership-unverified':
      return `The proxy could not verify this GROWI's URL: ${outcome.detail}`;
    case 'call-failed':
      return `Could not reach the proxy (${outcome.reason}).`;
    case 'key-encryption-unconfigured':
      return 'The encryption key is not configured -- pairing cannot start.';
    default:
      return 'Unknown outcome.';
  }
};

/** Pairing form: paste a registration code the proxy issued (task 7.3). Disabled while the encryption key is unconfigured. */
const PairingSection = ({
  encryptionConfigured,
  onPaired,
}: {
  encryptionConfigured: boolean;
  onPaired: () => void;
}): JSX.Element => {
  const [form, setForm] = useState<PairingFormState>(EMPTY_PAIRING_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // useId() output is safe here (id=/htmlFor= use getElementById, which does
  // not parse the colons useId() produces as CSS) -- see
  // apps/app/.claude/rules/ui-pitfalls.md. Only a reactstrap `target` prop
  // would be unsafe, and none of these fields use one.
  const registrationCodeId = useId();
  const proxyUriId = useId();
  const growiUriId = useId();
  const growiLabelId = useId();

  const handleChange = useCallback(
    (field: keyof PairingFormState) =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        setForm((prev) => ({ ...prev, [field]: e.target.value }));
      },
    [],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setIsSubmitting(true);
      try {
        const res = await apiv3Post<PairingOutcome>(
          '/chat-integration/admin/pairing',
          form,
        );
        const outcome = res.data;
        if (outcome.status === 'paired') {
          toastSuccess(describePairingOutcome(outcome));
          setForm(EMPTY_PAIRING_FORM);
          onPaired();
        } else {
          toastError(describePairingOutcome(outcome));
        }
      } catch (err) {
        toastError(err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [form, onPaired],
  );

  return (
    <div className="mb-5" data-testid="grw-chat-integration-pairing-section">
      <h2 className="admin-setting-header">Connect a workspace</h2>

      {!encryptionConfigured && (
        <div className="alert alert-warning" role="alert">
          The chat-integration encryption key is not configured. Pairing is
          disabled until an administrator sets it.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="mb-2">
          <label className="form-label" htmlFor={registrationCodeId}>
            Registration code
          </label>
          <input
            id={registrationCodeId}
            type="text"
            className="form-control"
            value={form.registrationCode}
            onChange={handleChange('registrationCode')}
            disabled={!encryptionConfigured}
            required
          />
        </div>
        <div className="mb-2">
          <label className="form-label" htmlFor={proxyUriId}>
            Proxy URL
          </label>
          <input
            id={proxyUriId}
            type="text"
            className="form-control"
            value={form.proxyUri}
            onChange={handleChange('proxyUri')}
            disabled={!encryptionConfigured}
            required
          />
        </div>
        <div className="mb-2">
          <label className="form-label" htmlFor={growiUriId}>
            This GROWI's URL
          </label>
          <input
            id={growiUriId}
            type="text"
            className="form-control"
            value={form.growiUri}
            onChange={handleChange('growiUri')}
            disabled={!encryptionConfigured}
            required
          />
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor={growiLabelId}>
            Label to show the chat service
          </label>
          <input
            id={growiLabelId}
            type="text"
            className="form-control"
            value={form.growiLabel}
            onChange={handleChange('growiLabel')}
            disabled={!encryptionConfigured}
            required
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!encryptionConfigured || isSubmitting}
        >
          {isSubmitting ? 'Pairing…' : 'Pair'}
        </button>
      </form>
    </div>
  );
};

// ============================================================================
// Main component
// ============================================================================

export const AdminChatIntegration = (): JSX.Element => {
  const { data: encryptionStatus } = useSWR<EncryptionStatus>(
    'chat-integration-admin-encryption-status',
    fetchEncryptionStatus,
  );
  const {
    data: relations,
    isLoading,
    mutate: mutateRelations,
  } = useSWR<AdminRelationListItem[]>(
    'chat-integration-admin-relations',
    fetchRelations,
  );

  // A pairing and an unpairing both change what the relation list says, so
  // both re-read it rather than patching the cached list locally.
  const handleRelationsChanged = useCallback(() => {
    mutateRelations();
  }, [mutateRelations]);

  return (
    <div data-testid="grw-chat-integration-admin">
      <PairingSection
        encryptionConfigured={encryptionStatus?.configured ?? false}
        onPaired={handleRelationsChanged}
      />

      <div>
        <h2 className="admin-setting-header">Connected workspaces</h2>
        {isLoading && <p>Loading…</p>}
        {!isLoading && (relations == null || relations.length === 0) && (
          <p>No workspace has been paired yet.</p>
        )}
        {relations?.map((relation) => (
          <RelationRow
            key={relation.relationId}
            relation={relation}
            onUnpaired={handleRelationsChanged}
          />
        ))}
      </div>
    </div>
  );
};

AdminChatIntegration.displayName = 'AdminChatIntegration';
