import type {
  AutoApplyPolicy,
  ChangeProposalSettingsUpdate,
  ChangeProposalSettingsView,
  CreatableOperationType,
} from '../../interfaces';

// Display and request order of the operation types.
export const OPERATION_TYPES = [
  'edit',
  'create',
  'move',
] as const satisfies readonly CreatableOperationType[];

export type ChangeProposalSettingsFormValues = {
  readonly isEnabled: boolean;
  readonly enabledOperationTypes: Readonly<
    Record<CreatableOperationType, boolean>
  >;
  readonly autoApplyPolicy: AutoApplyPolicy;
  // Limits are edited as text; '' means "no limit".
  readonly maxOperationsPerProposal: string;
  readonly maxProposalsPerUserPerDay: string;
  readonly perPageNotificationsEnabled: boolean;
};

const limitToText = (limit: number | null): string =>
  limit == null ? '' : String(limit);

const textToLimit = (text: string): number | null => {
  const trimmed = text.trim();
  return trimmed === '' ? null : Number(trimmed);
};

// Mirrors the PUT route's check: empty, or a safe integer of at least 1.
export const isValidLimitText = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed === '') {
    return true;
  }
  if (!/^\d+$/.test(trimmed)) {
    return false;
  }
  const limit = Number(trimmed);
  return Number.isSafeInteger(limit) && limit >= 1;
};

export const toFormValues = (
  view: ChangeProposalSettingsView,
): ChangeProposalSettingsFormValues => ({
  isEnabled: view.isEnabled,
  enabledOperationTypes: {
    edit: view.enabledOperationTypes.includes('edit'),
    create: view.enabledOperationTypes.includes('create'),
    move: view.enabledOperationTypes.includes('move'),
  },
  autoApplyPolicy: view.autoApplyPolicy,
  maxOperationsPerProposal: limitToText(view.maxOperationsPerProposal),
  maxProposalsPerUserPerDay: limitToText(view.maxProposalsPerUserPerDay),
  perPageNotificationsEnabled: view.perPageNotificationsEnabled,
});

const toOperationTypeList = (
  flags: ChangeProposalSettingsFormValues['enabledOperationTypes'],
): CreatableOperationType[] => OPERATION_TYPES.filter((type) => flags[type]);

const isSameOperationTypeSet = (
  a: readonly CreatableOperationType[],
  b: readonly CreatableOperationType[],
): boolean => a.length === b.length && a.every((type) => b.includes(type));

/**
 * Builds the PUT body from the values that differ from the loaded settings, so a
 * save never overwrites a value the admin did not touch.
 * Limit texts must already have passed isValidLimitText.
 */
export const buildUpdateRequest = (
  initial: ChangeProposalSettingsView,
  values: ChangeProposalSettingsFormValues,
): ChangeProposalSettingsUpdate => {
  const enabledOperationTypes = toOperationTypeList(
    values.enabledOperationTypes,
  );
  const maxOperationsPerProposal = textToLimit(values.maxOperationsPerProposal);
  const maxProposalsPerUserPerDay = textToLimit(
    values.maxProposalsPerUserPerDay,
  );

  return {
    ...(values.isEnabled !== initial.isEnabled && {
      isEnabled: values.isEnabled,
    }),
    ...(!isSameOperationTypeSet(
      enabledOperationTypes,
      initial.enabledOperationTypes,
    ) && { enabledOperationTypes }),
    ...(values.autoApplyPolicy !== initial.autoApplyPolicy && {
      autoApplyPolicy: values.autoApplyPolicy,
    }),
    ...(maxOperationsPerProposal !== initial.maxOperationsPerProposal && {
      maxOperationsPerProposal,
    }),
    ...(maxProposalsPerUserPerDay !== initial.maxProposalsPerUserPerDay && {
      maxProposalsPerUserPerDay,
    }),
    ...(values.perPageNotificationsEnabled !==
      initial.perPageNotificationsEnabled && {
      perPageNotificationsEnabled: values.perPageNotificationsEnabled,
    }),
  };
};
