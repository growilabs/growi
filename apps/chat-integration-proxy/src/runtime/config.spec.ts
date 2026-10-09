import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judgeGrowiUri } from '@growi/chat';

import { loadConfig } from './config.js';

/** 32 bytes, the only length AES-256 accepts. */
const VALID_KEY = Buffer.alloc(32, 7).toString('base64');

/** The minimum an operator has to set for the process to be allowed to start. */
const minimalEnv = (): NodeJS.ProcessEnv => ({
  SECRET_ENCRYPTION_KEY: VALID_KEY,
  CHAT_SDK_DATABASE_URL: 'postgresql://user:pass@postgres:5432/db',
  DATABASE_URL: 'postgresql://user:pass@postgres:5432/proxy',
});

const slackEnv = {
  SLACK_SIGNING_SECRET: 'signing-secret',
  SLACK_CLIENT_ID: 'client-id',
  SLACK_CLIENT_SECRET: 'client-secret',
  SLACK_APP_TOKEN: 'xapp-1-token',
};

describe('loadConfig', () => {
  describe('storage encryption key (fail closed)', () => {
    it('refuses without the key rather than returning a config that stores plaintext, naming the variable', () => {
      const env = minimalEnv();
      env.SECRET_ENCRYPTION_KEY = undefined;

      // Nothing usable comes back: the caller cannot obtain a cipher that
      // would let it write `installation.credentials` unencrypted.
      expect(() => loadConfig(env)).toThrow(/SECRET_ENCRYPTION_KEY/);
    });

    it('refuses a key that decodes to the wrong number of bytes', () => {
      const env = minimalEnv();
      env.SECRET_ENCRYPTION_KEY = Buffer.alloc(16, 7).toString('base64');

      expect(() => loadConfig(env)).toThrow(/SECRET_ENCRYPTION_KEY/);
      // The reason has to be visible to the operator: how long it is vs how
      // long it must be.
      expect(() => loadConfig(env)).toThrow(/16/);
      expect(() => loadConfig(env)).toThrow(/32/);
    });

    it('never repeats the configured key value in the error', () => {
      const env = minimalEnv();
      const wrongLengthKey = Buffer.from('super-secret-but-too-short').toString(
        'base64',
      );
      env.SECRET_ENCRYPTION_KEY = wrongLengthKey;

      expect(() => loadConfig(env)).toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining('super-secret'),
        }),
      );
      expect(() => loadConfig(env)).toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining(wrongLengthKey),
        }),
      );
    });

    it('starts when every required value is present', () => {
      expect(() => loadConfig(minimalEnv())).not.toThrow();
    });

    it('refuses to start without the state connection string', () => {
      const env = minimalEnv();
      env.CHAT_SDK_DATABASE_URL = undefined;

      expect(() => loadConfig(env)).toThrow(/CHAT_SDK_DATABASE_URL/);
    });
  });

  describe('the cipher handed to other layers', () => {
    it('returns the original text after a round trip', () => {
      const { cipher } = loadConfig(minimalEnv());

      const secret = 'xoxb-workspace-bot-token';
      expect(cipher.decrypt(cipher.encrypt(secret))).toBe(secret);
    });

    it('round-trips a multi-line PEM private key', () => {
      const { cipher } = loadConfig(minimalEnv());

      const pem =
        '-----BEGIN PRIVATE KEY-----\nMIIB\n+/=line2\n-----END PRIVATE KEY-----\n';
      expect(cipher.decrypt(cipher.encrypt(pem))).toBe(pem);
    });

    it('does not leave the plaintext readable in what gets stored', () => {
      const { cipher } = loadConfig(minimalEnv());

      const ciphertext = cipher.encrypt('xoxb-workspace-bot-token');

      expect(ciphertext).not.toContain('xoxb-workspace-bot-token');
      expect(Buffer.from(ciphertext).toString('latin1')).not.toContain(
        'xoxb-workspace-bot-token',
      );
    });

    it('produces a different ciphertext each time the same text is encrypted', () => {
      const { cipher } = loadConfig(minimalEnv());

      const first = cipher.encrypt('same-text');
      const second = cipher.encrypt('same-text');

      expect(first).not.toBe(second);
      expect(cipher.decrypt(first)).toBe('same-text');
      expect(cipher.decrypt(second)).toBe('same-text');
    });

    it('refuses a ciphertext that was altered after it was stored', () => {
      const { cipher } = loadConfig(minimalEnv());

      const ciphertext = cipher.encrypt('xoxb-workspace-bot-token');
      // Flip one bit of the stored bytes, the way a row edited in the database
      // would differ. (Editing the last base64 character is not enough: the
      // trailing bits of a base64 string need not encode anything.)
      const prefix = 'v1:';
      const raw = Buffer.from(ciphertext.slice(prefix.length), 'base64');
      raw[raw.length - 1] ^= 0x01;
      const altered = prefix + raw.toString('base64');

      expect(altered).not.toBe(ciphertext);
      expect(() => cipher.decrypt(altered)).toThrow();
    });

    it('refuses a ciphertext written under a different key', () => {
      const { cipher } = loadConfig(minimalEnv());
      const otherEnv = minimalEnv();
      otherEnv.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
      const otherCipher = loadConfig(otherEnv).cipher;

      expect(() => cipher.decrypt(otherCipher.encrypt('secret'))).toThrow();
    });

    it('refuses text that is not in the stored form at all', () => {
      const { cipher } = loadConfig(minimalEnv());

      expect(() =>
        cipher.decrypt('plain text that was never encrypted'),
      ).toThrow();
    });

    it('does not hand out the key itself', () => {
      const config = loadConfig(minimalEnv());

      expect(JSON.stringify(config.cipher)).not.toContain(VALID_KEY);
      expect(
        Object.values(config.cipher).every((v) => typeof v === 'function'),
      ).toBe(true);
    });
  });

  describe('per-app platform configuration', () => {
    it('leaves a service undefined when none of its variables are set', () => {
      const { platformApp } = loadConfig({ ...minimalEnv(), ...slackEnv });

      expect(platformApp.slack).toEqual({
        signingSecret: 'signing-secret',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        appToken: 'xapp-1-token',
      });
      expect(platformApp.discord).toBeUndefined();
      expect(platformApp.teams).toBeUndefined();
    });

    it('reads Discord and Teams independently of Slack', () => {
      const { platformApp } = loadConfig({
        ...minimalEnv(),
        DISCORD_APPLICATION_ID: 'app-id',
        DISCORD_PUBLIC_KEY: 'public-key',
        DISCORD_CLIENT_SECRET: 'discord-secret',
        DISCORD_BOT_TOKEN: 'bot-token',
        TEAMS_CLIENT_ID: 'teams-client-id',
        TEAMS_CLIENT_SECRET: 'teams-client-secret',
      });

      expect(platformApp.slack).toBeUndefined();
      expect(platformApp.discord).toEqual({
        applicationId: 'app-id',
        publicKey: 'public-key',
        clientSecret: 'discord-secret',
        botToken: 'bot-token',
      });
      expect(platformApp.teams).toEqual({
        clientId: 'teams-client-id',
        clientSecret: 'teams-client-secret',
      });
    });

    it('refuses to start on a half-configured service, naming only what is missing', () => {
      const env: NodeJS.ProcessEnv = { ...minimalEnv(), ...slackEnv };
      env.SLACK_APP_TOKEN = undefined;

      expect(() => loadConfig(env)).toThrow(/SLACK_APP_TOKEN/);
      expect(() => loadConfig(env)).toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining('SLACK_CLIENT_ID'),
        }),
      );
    });

    it('carries the state connection string separately from the app Prisma one', () => {
      const { platformApp } = loadConfig({
        ...minimalEnv(),
        DATABASE_URL: 'postgresql://prisma@postgres:5432/should-not-be-used',
      });

      expect(platformApp.stateConnectionString).toBe(
        'postgresql://user:pass@postgres:5432/db',
      );
    });
  });

  describe('closed-network destinations', () => {
    let caCertPath: string;
    const caCertPem =
      '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n';

    beforeAll(() => {
      const dir = mkdtempSync(join(tmpdir(), 'chat-proxy-config-'));
      caCertPath = join(dir, 'internal-ca.pem');
      writeFileSync(caCertPath, caCertPem);
    });

    it('is empty when the operator declared nothing', () => {
      const { closedNetwork } = loadConfig(minimalEnv());

      expect(closedNetwork.allowList).toEqual([]);
      expect(closedNetwork.trustedCaCertsFor('growi.internal')).toEqual([]);
    });

    it('exposes declared hostnames in the shape judgeGrowiUri matches against', () => {
      const { closedNetwork } = loadConfig({
        ...minimalEnv(),
        GROWI_ALLOWED_DESTINATIONS: JSON.stringify([
          { hostname: 'GROWI.internal.' },
          { hostname: 'wiki.example.local' },
        ]),
      });

      // judgeGrowiUri compares against a lowered hostname with no trailing dot.
      expect(closedNetwork.allowList).toEqual([
        'growi.internal',
        'wiki.example.local',
      ]);
    });

    it('hands back the certificate to trust for a declared destination', () => {
      const { closedNetwork } = loadConfig({
        ...minimalEnv(),
        GROWI_ALLOWED_DESTINATIONS: JSON.stringify([
          { hostname: 'growi.internal', caCertPath },
        ]),
      });

      expect(closedNetwork.trustedCaCertsFor('growi.internal')).toEqual([
        caCertPem,
      ]);
      // Matching follows the same normalisation as the allow list itself.
      expect(closedNetwork.trustedCaCertsFor('GROWI.internal.')).toEqual([
        caCertPem,
      ]);
      expect(closedNetwork.trustedCaCertsFor('other.internal')).toEqual([]);
    });

    it('accepts a destination with no certificate of its own (plain http closed network)', () => {
      const { closedNetwork } = loadConfig({
        ...minimalEnv(),
        GROWI_ALLOWED_DESTINATIONS: JSON.stringify([
          { hostname: 'growi.internal' },
        ]),
      });

      expect(closedNetwork.allowList).toEqual(['growi.internal']);
      expect(closedNetwork.trustedCaCertsFor('growi.internal')).toEqual([]);
    });

    it('refuses a hostname written as a URL, which would never match anything', () => {
      const env = {
        ...minimalEnv(),
        GROWI_ALLOWED_DESTINATIONS: JSON.stringify([
          { hostname: 'https://growi.internal:3000/' },
        ]),
      };

      expect(() => loadConfig(env)).toThrow(/GROWI_ALLOWED_DESTINATIONS/);
      expect(() => loadConfig(env)).toThrow(/https:\/\/growi\.internal:3000\//);
    });

    it('refuses a hostname carrying a port', () => {
      expect(() =>
        loadConfig({
          ...minimalEnv(),
          GROWI_ALLOWED_DESTINATIONS: JSON.stringify([
            { hostname: 'growi.internal:3000' },
          ]),
        }),
      ).toThrow(/GROWI_ALLOWED_DESTINATIONS/);
    });

    it('accepts an IPv6 literal written in brackets', () => {
      const { closedNetwork } = loadConfig({
        ...minimalEnv(),
        GROWI_ALLOWED_DESTINATIONS: JSON.stringify([{ hostname: '[fd00::1]' }]),
      });

      expect(closedNetwork.allowList).toEqual(['fd00::1']);
    });

    it('refuses a declaration that is not readable as the documented shape', () => {
      expect(() =>
        loadConfig({
          ...minimalEnv(),
          GROWI_ALLOWED_DESTINATIONS: 'growi.internal',
        }),
      ).toThrow(/GROWI_ALLOWED_DESTINATIONS/);

      expect(() =>
        loadConfig({
          ...minimalEnv(),
          GROWI_ALLOWED_DESTINATIONS: JSON.stringify({
            hostname: 'growi.internal',
          }),
        }),
      ).toThrow(/GROWI_ALLOWED_DESTINATIONS/);

      expect(() =>
        loadConfig({
          ...minimalEnv(),
          GROWI_ALLOWED_DESTINATIONS: JSON.stringify([
            { host: 'growi.internal' },
          ]),
        }),
      ).toThrow(/GROWI_ALLOWED_DESTINATIONS/);
    });

    it('refuses a certificate path that cannot be read at startup', () => {
      const missingPath = join(tmpdir(), 'chat-proxy-config-absent', 'ca.pem');

      expect(() =>
        loadConfig({
          ...minimalEnv(),
          GROWI_ALLOWED_DESTINATIONS: JSON.stringify([
            { hostname: 'growi.internal', caCertPath: missingPath },
          ]),
        }),
      ).toThrow(new RegExp(missingPath.replace(/[/\\]/g, '.')));
    });

    it('produces entries that judgeGrowiUri itself exempts', () => {
      const { closedNetwork } = loadConfig({
        ...minimalEnv(),
        GROWI_ALLOWED_DESTINATIONS: JSON.stringify([
          { hostname: 'GROWI.internal.' },
        ]),
      });

      // The Requirement 13.1 form: plain http, non-default port, private
      // address. This is what the declaration exists to let through, and it
      // only works if what this module writes matches what judgeGrowiUri
      // compares against.
      expect(
        judgeGrowiUri(
          'http://growi.internal:3000/',
          ['10.1.2.3'],
          closedNetwork.allowList,
        ),
      ).toEqual({ ok: true });

      expect(
        judgeGrowiUri(
          'http://other.internal:3000/',
          ['10.1.2.3'],
          closedNetwork.allowList,
        ).ok,
      ).toBe(false);
    });

    it('refuses a file that is not a certificate', () => {
      const dir = mkdtempSync(join(tmpdir(), 'chat-proxy-config-'));
      const notACert = join(dir, 'not-a-cert.pem');
      writeFileSync(notACert, 'hello');

      expect(() =>
        loadConfig({
          ...minimalEnv(),
          GROWI_ALLOWED_DESTINATIONS: JSON.stringify([
            { hostname: 'growi.internal', caCertPath: notACert },
          ]),
        }),
      ).toThrow(/BEGIN CERTIFICATE/);
    });
  });

  describe(`the app's own storage connection`, () => {
    it('carries DATABASE_URL, which is what the Prisma client is built from', () => {
      expect(loadConfig(minimalEnv()).databaseUrl).toBe(
        'postgresql://user:pass@postgres:5432/proxy',
      );
    });

    it('refuses to start without it, naming the variable', () => {
      const env = minimalEnv();
      env.DATABASE_URL = undefined;

      expect(() => loadConfig(env)).toThrow(/DATABASE_URL/);
    });
  });

  describe('the HTTP listener', () => {
    it('serves on a default port when none is configured, because the endpoints are always open', () => {
      expect(loadConfig(minimalEnv()).http.port).toBe(8080);
    });

    it('takes the configured port', () => {
      expect(loadConfig({ ...minimalEnv(), PORT: '3210' }).http.port).toBe(
        3210,
      );
    });

    it('refuses a port that is not a usable port number', () => {
      for (const port of ['0', '-1', '70000', 'http', '80.5']) {
        expect(() => loadConfig({ ...minimalEnv(), PORT: port })).toThrow(
          /PORT/,
        );
      }
    });

    it('caps request bodies by default, so an unauthenticated caller cannot choose how much memory to use', () => {
      expect(loadConfig(minimalEnv()).http.bodyLimitBytes).toBeGreaterThan(0);
    });

    it('takes a configured cap', () => {
      expect(
        loadConfig({ ...minimalEnv(), MAX_REQUEST_BODY_BYTES: '65536' }).http
          .bodyLimitBytes,
      ).toBe(65536);
    });

    it('refuses a cap that is not a positive whole number of bytes', () => {
      for (const size of ['0', '-1', '1mb', '1.5']) {
        expect(() =>
          loadConfig({ ...minimalEnv(), MAX_REQUEST_BODY_BYTES: size }),
        ).toThrow(/MAX_REQUEST_BODY_BYTES/);
      }
    });
  });

  describe('Mattermost installations declared up front', () => {
    const declared = [
      {
        workspaceId: 'team-1',
        workspaceName: 'Example Team',
        baseUrl: 'https://mattermost.internal',
        botToken: 'bot-token',
      },
    ];

    it('is empty when nothing is declared', () => {
      expect(loadConfig(minimalEnv()).mattermostInstallations).toEqual([]);
    });

    it('reads every declared installation', () => {
      expect(
        loadConfig({
          ...minimalEnv(),
          MATTERMOST_INSTALLATIONS: JSON.stringify(declared),
        }).mattermostInstallations,
      ).toEqual(declared);
    });

    it('refuses a declaration that is not readable as JSON', () => {
      expect(() =>
        loadConfig({ ...minimalEnv(), MATTERMOST_INSTALLATIONS: 'not json' }),
      ).toThrow(/MATTERMOST_INSTALLATIONS/);
    });

    it('refuses an entry missing a field the connection cannot be opened without, naming the field', () => {
      for (const field of [
        'workspaceId',
        'workspaceName',
        'baseUrl',
        'botToken',
      ]) {
        const incomplete = { ...declared[0] };
        delete (incomplete as Record<string, unknown>)[field];

        expect(() =>
          loadConfig({
            ...minimalEnv(),
            MATTERMOST_INSTALLATIONS: JSON.stringify([incomplete]),
          }),
        ).toThrow(new RegExp(field));
      }
    });

    it('never repeats a declared bot token in the error', () => {
      expect(() =>
        loadConfig({
          ...minimalEnv(),
          MATTERMOST_INSTALLATIONS: JSON.stringify([
            { ...declared[0], baseUrl: undefined },
          ]),
        }),
      ).toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining('bot-token'),
        }),
      );
    });
  });
});
