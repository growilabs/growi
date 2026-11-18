import { configManager } from '~/server/service/config-manager';
import type {
  ConfigKey,
  ConfigValues,
} from '~/server/service/config-manager/config-definition';

import type {
  AutoApplyPolicy,
  ChangeProposalSettingsUpdate,
  CreatableOperationType,
} from '../../interfaces';

export type ChangeProposalSettings = {
  readonly isEnabled: boolean;
  readonly enabledOperationTypes: ReadonlySet<CreatableOperationType>;
  readonly autoApplyPolicy: AutoApplyPolicy;
  readonly maxOperationsPerProposal: number | null;
  readonly maxProposalsPerUserPerDay: number | null;
  readonly pendingExpirationSeconds: number | null;
  readonly perPageNotificationsEnabled: boolean;
};

const OPERATION_TYPE_SWITCH_KEYS = {
  edit: 'changeProposal:isEditEnabled',
  create: 'changeProposal:isCreateEnabled',
  move: 'changeProposal:isMoveEnabled',
} as const satisfies Record<CreatableOperationType, ConfigKey>;

export const CREATABLE_OPERATION_TYPES = Object.keys(
  OPERATION_TYPE_SWITCH_KEYS,
) as readonly CreatableOperationType[];

export const AUTO_APPLY_POLICIES: readonly AutoApplyPolicy[] = [
  'none',
  'own-pages',
  'all',
];

// An unusable stored number must never turn into a limit of 0 or NaN.
const toLimit = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;

// config-manager resolves "DB value ?? env/default", so a cleared limit must be
// stored as 0 (read back as null by toLimit); null would restore the default.
const toStoredLimit = (value: number | null): number => value ?? 0;

const toAutoApplyPolicy = (value: unknown): AutoApplyPolicy =>
  AUTO_APPLY_POLICIES.find((policy) => policy === value) ?? 'none';

export const readChangeProposalSettings = (): ChangeProposalSettings => {
  const enabledOperationTypes = new Set<CreatableOperationType>();
  for (const [type, key] of Object.entries(OPERATION_TYPE_SWITCH_KEYS)) {
    if (configManager.getConfig(key) === true) {
      enabledOperationTypes.add(type as CreatableOperationType);
    }
  }

  return {
    isEnabled: configManager.getConfig('app:changeProposalEnabled') === true,
    enabledOperationTypes,
    autoApplyPolicy: toAutoApplyPolicy(
      configManager.getConfig('changeProposal:autoApplyPolicy'),
    ),
    maxOperationsPerProposal: toLimit(
      configManager.getConfig('changeProposal:maxOperationsPerProposal'),
    ),
    maxProposalsPerUserPerDay: toLimit(
      configManager.getConfig('changeProposal:maxProposalsPerUserPerDay'),
    ),
    pendingExpirationSeconds: toLimit(
      configManager.getConfig('changeProposal:pendingExpirationSeconds'),
    ),
    perPageNotificationsEnabled:
      configManager.getConfig('changeProposal:perPageNotificationsEnabled') ===
      true,
  };
};

export const updateChangeProposalSettings = async (
  input: ChangeProposalSettingsUpdate,
): Promise<void> => {
  const updates: { -readonly [K in ConfigKey]?: ConfigValues[K] } = {};

  if (input.isEnabled !== undefined) {
    updates['app:changeProposalEnabled'] = input.isEnabled;
  }
  if (input.enabledOperationTypes !== undefined) {
    for (const [type, key] of Object.entries(OPERATION_TYPE_SWITCH_KEYS)) {
      updates[key] = input.enabledOperationTypes.includes(
        type as CreatableOperationType,
      );
    }
  }
  if (input.autoApplyPolicy !== undefined) {
    updates['changeProposal:autoApplyPolicy'] = input.autoApplyPolicy;
  }
  if (input.maxOperationsPerProposal !== undefined) {
    updates['changeProposal:maxOperationsPerProposal'] = toStoredLimit(
      input.maxOperationsPerProposal,
    );
  }
  if (input.maxProposalsPerUserPerDay !== undefined) {
    updates['changeProposal:maxProposalsPerUserPerDay'] = toStoredLimit(
      input.maxProposalsPerUserPerDay,
    );
  }
  if (input.perPageNotificationsEnabled !== undefined) {
    updates['changeProposal:perPageNotificationsEnabled'] =
      input.perPageNotificationsEnabled;
  }

  if (Object.keys(updates).length === 0) {
    return;
  }
  await configManager.updateConfigs(updates);
};
