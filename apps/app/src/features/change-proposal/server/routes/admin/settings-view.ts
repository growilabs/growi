import { configManager } from '~/server/service/config-manager';

import type { ChangeProposalSettingsView } from '../../../interfaces';
import { readChangeProposalSettings } from '../../services/settings';

export const isFixedByEnvVars = (): boolean =>
  configManager.getConfig('env:useOnlyEnvVars:changeProposal') === true;

export const readChangeProposalSettingsView =
  (): ChangeProposalSettingsView => {
    const settings = readChangeProposalSettings();
    return {
      isEnabled: settings.isEnabled,
      enabledOperationTypes: [...settings.enabledOperationTypes],
      autoApplyPolicy: settings.autoApplyPolicy,
      maxOperationsPerProposal: settings.maxOperationsPerProposal,
      maxProposalsPerUserPerDay: settings.maxProposalsPerUserPerDay,
      perPageNotificationsEnabled: settings.perPageNotificationsEnabled,
      useOnlyEnvVars: isFixedByEnvVars(),
    };
  };
