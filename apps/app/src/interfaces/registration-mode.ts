export const RegistrationMode = {
  OPEN: 'Open',
  RESTRICTED: 'Restricted',
  CLOSED: 'Closed',
} as const;

export type RegistrationMode =
  (typeof RegistrationMode)[keyof typeof RegistrationMode];
