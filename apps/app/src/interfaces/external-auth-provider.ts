export const IExternalAuthProviderType = {
  ldap: 'ldap',
  saml: 'saml',
  oidc: 'oidc',
  google: 'google',
  github: 'github',
} as const;

export type IExternalAuthProviderType =
  (typeof IExternalAuthProviderType)[keyof typeof IExternalAuthProviderType];
