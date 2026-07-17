import passport from 'passport';
import type { MockInstance } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type UserEvent from '~/server/events/user';

import { configManager } from './config-manager';
import PassportService from './passport';

describe('PassportService test', () => {
  let crowiMock: Crowi;

  beforeAll(async () => {
    crowiMock = mock<Crowi>({
      events: {
        user: mock<UserEvent>({
          on: vi.fn(),
        }),
      },
    });
  });

  describe('verifySAMLResponseByABLCRule()', () => {
    const passportService = new PassportService(crowiMock);

    let getConfigSpy: MockInstance<typeof configManager.getConfig>;
    let extractAttributesFromSAMLResponseSpy: MockInstance<
      typeof passportService.extractAttributesFromSAMLResponse
    >;

    beforeEach(async () => {
      // prepare spy for ConfigManager.getConfig
      getConfigSpy = vi.spyOn(configManager, 'getConfig');
      // prepare spy for extractAttributesFromSAMLResponse method
      extractAttributesFromSAMLResponseSpy = vi.spyOn(
        passportService,
        'extractAttributesFromSAMLResponse',
      );
    });

    let i = 0;
    describe.each`
      conditionId | departments   | positions     | ruleStr                                                   | expected
      ${i++}      | ${undefined}  | ${undefined}  | ${' '}                                                    | ${true}
      ${i++}      | ${undefined}  | ${undefined}  | ${'Department: A'}                                        | ${false}
      ${i++}      | ${[]}         | ${['Leader']} | ${'Position'}                                             | ${true}
      ${i++}      | ${[]}         | ${['Leader']} | ${'Position: Leader'}                                     | ${true}
      ${i++}      | ${['A']}      | ${[]}         | ${'Department: A || Department: B && Position: Leader'}   | ${true}
      ${i++}      | ${['B']}      | ${['Leader']} | ${'Department: A || Department: B && Position: Leader'}   | ${true}
      ${i++}      | ${['A', 'C']} | ${['Leader']} | ${'Department: A || Department: B && Position: Leader'}   | ${true}
      ${i++}      | ${['B', 'C']} | ${['Leader']} | ${'Department: A || Department: B && Position: Leader'}   | ${true}
      ${i++}      | ${[]}         | ${[]}         | ${'Department: A || Department: B && Position: Leader'}   | ${false}
      ${i++}      | ${['C']}      | ${['Leader']} | ${'Department: A || Department: B && Position: Leader'}   | ${false}
      ${i++}      | ${['A']}      | ${['Leader']} | ${'(Department: A || Department: B) && Position: Leader'} | ${true}
      ${i++}      | ${['B']}      | ${['Leader']} | ${'(Department: A || Department: B) && Position: Leader'} | ${true}
      ${i++}      | ${['C']}      | ${['Leader']} | ${'(Department: A || Department: B) && Position: Leader'} | ${false}
      ${i++}      | ${['A', 'B']} | ${[]}         | ${'(Department: A || Department: B) && Position: Leader'} | ${false}
      ${i++}      | ${['A']}      | ${[]}         | ${'Department: A NOT Position: Leader'}                   | ${true}
      ${i++}      | ${['A']}      | ${['Leader']} | ${'Department: A NOT Position: Leader'}                   | ${false}
      ${i++}      | ${[]}         | ${['Leader']} | ${'Department: A OR (Position NOT Position: User)'}       | ${true}
      ${i++}      | ${[]}         | ${['User']}   | ${'Department: A OR (Position NOT Position: User)'}       | ${false}
    `(
      'to be $expected under rule="$ruleStr"',
      ({ conditionId, departments, positions, ruleStr, expected }) => {
        test(`when conditionId=${conditionId}`, async () => {
          const responseMock = {};

          // setup mock implementation
          getConfigSpy.mockImplementation((key) => {
            if (key === 'security:passport-saml:ABLCRule') {
              return ruleStr;
            }
            throw new Error('Unexpected behavior.');
          });
          extractAttributesFromSAMLResponseSpy.mockImplementation(
            (response) => {
              if (response !== responseMock) {
                throw new Error('Unexpected args.');
              }
              return {
                Department: departments,
                Position: positions,
              };
            },
          );

          const result =
            passportService.verifySAMLResponseByABLCRule(responseMock);

          expect(result).toBe(expected);
        });
      },
    );
  });
});

describe('strategy setup — lazy SDK loading contract', () => {
  let crowiMock: Crowi;
  let passportService: PassportService;
  let useSpy: MockInstance<typeof passport.use>;
  let getConfigSpy: MockInstance<typeof configManager.getConfig>;

  beforeEach(() => {
    // In production `crowi.configManager` IS the module-level configManager
    // singleton; wiring the mock to the real one lets a single getConfig spy
    // drive every strategy (LDAP reads crowi.configManager; the others read
    // the module import directly).
    crowiMock = mock<Crowi>({ configManager });
    passportService = new PassportService(crowiMock);

    // Isolate from the real passport singleton: assert on registration without
    // mutating global strategy state. `new XStrategy(...)` (the argument) is
    // still constructed, so the enabled-path tests still exercise the real
    // lazy import() and the SDK's runtime export shape.
    useSpy = vi.spyOn(passport, 'use').mockReturnValue(passport);
    vi.spyOn(passport, 'unuse').mockReturnValue(passport);

    getConfigSpy = vi.spyOn(configManager, 'getConfig');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when the provider is disabled', () => {
    beforeEach(() => {
      // every "...:isEnabled" lookup resolves falsy
      getConfigSpy.mockReturnValue(undefined);
    });

    it.each`
      method                   | flag
      ${'setupLdapStrategy'}   | ${'isLdapStrategySetup'}
      ${'setupSamlStrategy'}   | ${'isSamlStrategySetup'}
      ${'setupOidcStrategy'}   | ${'isOidcStrategySetup'}
      ${'setupGoogleStrategy'} | ${'isGoogleStrategySetup'}
      ${'setupGitHubStrategy'} | ${'isGitHubStrategySetup'}
    `(
      '$method registers no strategy and leaves $flag false',
      async ({ method, flag }) => {
        await passportService[method]();

        expect(useSpy).not.toHaveBeenCalled();
        expect(passportService[flag]).toBe(false);
      },
    );
  });

  describe('when the provider is enabled', () => {
    it('setupLdapStrategy lazy-loads passport-ldapauth (default export) and registers', async () => {
      getConfigSpy.mockImplementation((key) => {
        if (key === 'security:passport-ldap:isEnabled') return true;
        if (key === 'security:passport-ldap:serverUrl')
          return 'ldap://localhost:389/dc=example,dc=org';
        return undefined;
      });

      await passportService.setupLdapStrategy();

      expect(useSpy).toHaveBeenCalledTimes(1);
      expect(passportService.isLdapStrategySetup).toBe(true);
    });

    it('setupSamlStrategy lazy-loads passport-saml and registers', async () => {
      getConfigSpy.mockImplementation((key) => {
        switch (key) {
          case 'security:passport-saml:isEnabled':
            return true;
          case 'security:passport-saml:cert':
            return 'dummy-cert';
          case 'security:passport-saml:entryPoint':
            return 'https://idp.example.com/sso';
          case 'security:passport-saml:issuer':
            return 'growi';
          case 'security:passport-saml:callbackUrl':
            return 'http://localhost:3000/passport/saml/callback';
          default:
            return undefined; // app:siteUrl null -> uses callbackUrl above
        }
      });

      await passportService.setupSamlStrategy();

      expect(useSpy).toHaveBeenCalledTimes(1);
      expect(passportService.isSamlStrategySetup).toBe(true);
    });

    it.each`
      provider    | method                   | flag
      ${'google'} | ${'setupGoogleStrategy'} | ${'isGoogleStrategySetup'}
      ${'github'} | ${'setupGitHubStrategy'} | ${'isGitHubStrategySetup'}
    `(
      '$method lazy-loads its OAuth SDK and registers',
      async ({ provider, method, flag }) => {
        getConfigSpy.mockImplementation((key) => {
          switch (key) {
            case `security:passport-${provider}:isEnabled`:
              return true;
            case `security:passport-${provider}:clientId`:
              return 'test-client-id';
            case `security:passport-${provider}:clientSecret`:
              return 'test-client-secret';
            default:
              return undefined; // app:siteUrl null -> uses legacy callbackUrl
          }
        });
        vi.spyOn(configManager, 'getConfigLegacy').mockReturnValue(
          `http://localhost:3000/passport/${provider}/callback`,
        );

        await passportService[method]();

        expect(useSpy).toHaveBeenCalledTimes(1);
        expect(passportService[flag]).toBe(true);
      },
    );

    it('setupOidcStrategy lazy-loads openid-client without throwing and does not register when the issuer is unreachable', async () => {
      // enabled, but issuerHost is unset so getOIDCIssuerInstance returns early
      // (no network). This still executes the openid-client import() and the
      // `custom.setHttpOptionsDefaults` call, so it proves the named-export
      // shape at runtime; if the import shape were wrong it would throw here.
      getConfigSpy.mockImplementation((key) => {
        if (key === 'security:passport-oidc:isEnabled') return true;
        if (key === 'security:passport-oidc:oidcIssuerTimeoutOption')
          return 5000;
        return undefined; // issuerHost undefined -> early return, no network
      });
      vi.spyOn(configManager, 'getConfigLegacy').mockReturnValue(undefined);

      await expect(
        passportService.setupOidcStrategy(),
      ).resolves.toBeUndefined();

      expect(useSpy).not.toHaveBeenCalled();
      expect(passportService.isOidcStrategySetup).toBe(false);
    });
  });
});
