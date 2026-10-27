import type {
  AutoApplyPolicy,
  CreatableOperationType,
} from './change-proposal';

// null limits mean "not checked".
export type ChangeProposalSettingsView = {
  readonly isEnabled: boolean;
  readonly enabledOperationTypes: readonly CreatableOperationType[];
  readonly autoApplyPolicy: AutoApplyPolicy;
  readonly maxOperationsPerProposal: number | null;
  readonly maxProposalsPerUserPerDay: number | null;
  readonly perPageNotificationsEnabled: boolean;
  // env:useOnlyEnvVars:changeProposal fixes every value above to its env var.
  readonly useOnlyEnvVars: boolean;
};

export type ChangeProposalSettingsUpdate = Partial<
  Omit<ChangeProposalSettingsView, 'useOnlyEnvVars'>
>;
