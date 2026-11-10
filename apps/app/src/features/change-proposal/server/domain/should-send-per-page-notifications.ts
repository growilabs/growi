export const shouldSendPerPageNotifications = (
  isEnabledBySettings: boolean,
  proposalValue: boolean,
): boolean => isEnabledBySettings && proposalValue;
