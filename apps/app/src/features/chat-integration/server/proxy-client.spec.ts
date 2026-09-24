import { generateKeyPairSync } from 'node:crypto';
import { OP_ENDPOINTS, OP_NAMES } from '@growi/chat';
import { verify } from '@growi/chat/server';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import urljoin from 'url-join';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { storeOwnKey } from './keys';
import type { ChatKeyEncryptionEnv } from './keys/key-encryption';
import { ChatRelation } from './models/chat-relation';
import {
  fetchCapabilities,
  fetchChannels,
  fetchConnectionStatus,
  notify,
  pushSettings,
  registerKeyWithProxy,
  revokeKeyWithProxy,
  submitPairing,
} from './proxy-client';

// `~/utils/axios` is this codebase's established outbound-HTTP boundary for
// server code that must never reach the raw `axios` package directly (see
// `apps/app/src/server/service/g2g-transfer.spec.ts` for the same pattern,
// and `.claude/rules/coding-style.md`'s executor rule for why the boundary
// is mocked rather than the transport underneath it). `proxy-client.ts` is
// exactly this kind of executor: it sends whatever op it is asked to, and
// the tests below drive it through that one seam.
vi.mock('~/utils/axios', () => ({
  default: { post: vi.fn() },
}));

import axios from '~/utils/axios';

const TEST_ENCRYPTION_KEY: ChatKeyEncryptionEnv = {
  CHAT_INTEGRATION_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
};

const PROXY_URI = 'https://proxy.example.com';

/** Builds a fake successful axios response carrying a JSON-stringified body. */
const jsonResponse = (status: number, data: unknown) => ({
  status,
  data: JSON.stringify(data),
});

/**
 * Normalizes an axios call's `config.headers` (typed as `AxiosRequestConfig`,
 * whose header values are not plain strings) down to what `verify()` needs --
 * the same shape `signature-guard.ts`'s own `stringHeadersOf` produces on
 * the receiving side. `axios.post` is mocked in this file, so the value
 * passed here is always the plain object this module's own `sendSigned`
 * built, never anything `AxiosHeaders`-specific -- this is purely to satisfy
 * the wider static type the real `axios` package declares for it.
 */
const stringHeaders = (headers: unknown): Record<string, string> => {
  const result: Record<string, string> = {};
  if (headers != null && typeof headers === 'object') {
    for (const [name, value] of Object.entries(
      headers as Record<string, unknown>,
    )) {
      if (typeof value === 'string') {
        result[name] = value;
      }
    }
  }
  return result;
};

describe('proxy-client', () => {
  let mongod: MongoMemoryServer | undefined;
  const previousEnv = { ...process.env };

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_proxy_client',
    ));
  });

  beforeEach(async () => {
    await ChatRelation.deleteMany({});
    Object.assign(process.env, TEST_ENCRYPTION_KEY);
    vi.mocked(axios.post).mockReset();
  });

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  /** Creates a relation with a currently-usable own signing key, and returns its ids. */
  const setUpRelation = async (relationId: string) => {
    const keyId = `${relationId}-own-key`;
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    await ChatRelation.create({
      relationId,
      proxyUri: PROXY_URI,
      platform: 'slack',
      workspaceId: 'workspace-1',
      workspaceName: 'Workspace One',
      label: null,
      state: 'active',
      settingsVersion: 0,
      createdAt: new Date(),
    });
    await storeOwnKey({ relationId, keyId }, privateKey);
    return { keyId, publicKey };
  };

  describe('all 8 ops can be sent and a well-formed response is returned parsed', () => {
    it('notify: posts to the notification endpoint and returns the parsed NotificationResult', async () => {
      const relationId = 'relation-notify';
      await setUpRelation(relationId);
      const result = {
        outcomes: [{ platform: 'slack', channelId: 'C1', status: 'posted' }],
      };
      vi.mocked(axios.post).mockResolvedValueOnce(jsonResponse(200, result));

      const outcome = await notify(relationId, {
        requestId: 'req-1',
        targets: [{ platform: 'slack', channelId: 'C1' }],
        markdown: 'hello',
        containsRestrictedPage: false,
      });

      expect(outcome).toEqual({ ok: true, response: result });
      expect(axios.post).toHaveBeenCalledWith(
        urljoin(PROXY_URI, '/chat-integration/notification'),
        expect.any(String),
        expect.anything(),
      );
    });

    it('pushSettings: posts to the settings-push endpoint and succeeds on the bare 204 the proxy answers with', async () => {
      const relationId = 'relation-settings-push';
      await setUpRelation(relationId);
      // The real proxy answers this op with an empty 204 body -- see
      // `apps/chat-integration-proxy/src/routes/notification-routes.ts`.
      vi.mocked(axios.post).mockResolvedValueOnce({ status: 204, data: '' });

      const outcome = await pushSettings(relationId, {
        settings: { relationId, channelPermissions: [] },
        version: 1,
      });

      expect(outcome).toEqual({ ok: true, response: undefined });
      expect(axios.post).toHaveBeenCalledWith(
        urljoin(PROXY_URI, '/chat-integration/settings-push'),
        expect.any(String),
        expect.anything(),
      );
    });

    it('registerKeyWithProxy: posts to the key registration endpoint and returns the parsed KeyOperationResult', async () => {
      const relationId = 'relation-key-register';
      await setUpRelation(relationId);
      const result = { status: 'ok' };
      vi.mocked(axios.post).mockResolvedValueOnce(jsonResponse(200, result));

      const { publicKey } = generateKeyPairSync('ed25519');
      const outcome = await registerKeyWithProxy(relationId, {
        keyId: 'new-key',
        publicKeyJwk: publicKey.export({ format: 'jwk' }),
        validFrom: new Date().toISOString(),
      });

      expect(outcome).toEqual({ ok: true, response: result });
      expect(axios.post).toHaveBeenCalledWith(
        urljoin(PROXY_URI, '/chat-integration/keys/register'),
        expect.any(String),
        expect.anything(),
      );
    });

    it('revokeKeyWithProxy: posts to the key revocation endpoint and returns the parsed KeyOperationResult, including a rejection', async () => {
      const relationId = 'relation-key-revoke';
      await setUpRelation(relationId);
      const result = { status: 'rejected', reason: 'would-leave-no-valid-key' };
      vi.mocked(axios.post).mockResolvedValueOnce(jsonResponse(200, result));

      const outcome = await revokeKeyWithProxy(relationId, 'some-key-id');

      expect(outcome).toEqual({ ok: true, response: result });
      expect(axios.post).toHaveBeenCalledWith(
        urljoin(PROXY_URI, '/chat-integration/keys/revoke'),
        expect.any(String),
        expect.anything(),
      );
    });

    it('fetchCapabilities: posts to the capabilities endpoint and returns the parsed CapabilityReport', async () => {
      const relationId = 'relation-capabilities';
      await setUpRelation(relationId);
      const result = {
        platforms: [
          {
            platform: 'slack',
            capabilities: [
              { capability: 'slashCommand', level: 'none', substitute: null },
            ],
          },
        ],
      };
      vi.mocked(axios.post).mockResolvedValueOnce(jsonResponse(200, result));

      const outcome = await fetchCapabilities(relationId);

      expect(outcome).toEqual({ ok: true, response: result });
      expect(axios.post).toHaveBeenCalledWith(
        urljoin(PROXY_URI, '/chat-integration/capabilities'),
        expect.any(String),
        expect.anything(),
      );
    });

    it('fetchConnectionStatus: posts to the connection-status endpoint and returns the parsed ConnectionStatusView', async () => {
      const relationId = 'relation-connection-status';
      await setUpRelation(relationId);
      const result = {
        platform: 'slack',
        health: 'connected',
        since: new Date().toISOString(),
      };
      vi.mocked(axios.post).mockResolvedValueOnce(jsonResponse(200, result));

      const outcome = await fetchConnectionStatus(relationId);

      expect(outcome).toEqual({ ok: true, response: result });
      expect(axios.post).toHaveBeenCalledWith(
        urljoin(PROXY_URI, '/chat-integration/connection-status'),
        expect.any(String),
        expect.anything(),
      );
    });

    it('fetchChannels: posts to the channels endpoint and returns the parsed ChannelInventory', async () => {
      const relationId = 'relation-channels';
      await setUpRelation(relationId);
      const result = {
        channels: [
          {
            platform: 'slack',
            channelId: 'C1',
            channelName: 'general',
            isPrivate: false,
          },
        ],
      };
      vi.mocked(axios.post).mockResolvedValueOnce(jsonResponse(200, result));

      const outcome = await fetchChannels(relationId);

      expect(outcome).toEqual({ ok: true, response: result });
      expect(axios.post).toHaveBeenCalledWith(
        urljoin(PROXY_URI, '/chat-integration/channels'),
        expect.any(String),
        expect.anything(),
      );
    });

    it('submitPairing: posts to the pairing submission endpoint against an explicit proxyUri (no stored relation) and returns the parsed PairingResult', async () => {
      const result = { status: 'code-expired' };
      vi.mocked(axios.post).mockResolvedValueOnce(jsonResponse(200, result));

      const { publicKey } = generateKeyPairSync('ed25519');
      const outcome = await submitPairing(PROXY_URI, {
        registrationCode: 'ABCDEF',
        growiUri: 'https://growi.example.com',
        growiLabel: 'My GROWI',
        publicKey: {
          keyId: 'growi-key-1',
          publicKeyJwk: publicKey.export({ format: 'jwk' }),
          validFrom: new Date().toISOString(),
        },
      });

      expect(outcome).toEqual({ ok: true, response: result });
      expect(axios.post).toHaveBeenCalledWith(
        urljoin(PROXY_URI, '/chat-integration/pairing/submit'),
        expect.any(String),
        expect.anything(),
      );
    });
  });

  describe('every signed op carries a valid RFC 9421 signature that @growi/chat itself verifies', () => {
    // Rather than repeating a full round-trip for all 7 signed ops (the
    // signing path is the same `sendSigned` helper for every one of them --
    // only the op name and body fields differ), this checks the property on
    // two ops picked to be structurally different from each other:
    // `notify` (has extra request fields beyond the envelope) and
    // `fetchCapabilities` (an envelope-only `OpOnlyRequest`). Both going
    // through means the signing step does not depend on the shape of the
    // op-specific fields.
    it.each([
      [
        'notify',
        () =>
          notify('relation-verify-notify', {
            requestId: 'req-1',
            targets: [{ platform: 'slack', channelId: 'C1' }],
            markdown: 'hi',
            containsRestrictedPage: false,
          }),
        'relation-verify-notify',
      ],
      [
        'fetchCapabilities',
        () => fetchCapabilities('relation-verify-capabilities'),
        'relation-verify-capabilities',
      ],
    ] as const)('%s signs a request that verify() accepts', async (_label, call, relationId) => {
      const { publicKey } = await setUpRelation(relationId);
      vi.mocked(axios.post).mockResolvedValueOnce(
        jsonResponse(200, { outcomes: [], platforms: [] }),
      );

      await call();

      const [, body, config = {}] = vi.mocked(axios.post).mock.calls[0];
      const verifyResult = await verify({
        method: 'POST',
        headers: stringHeaders(config.headers),
        body: Buffer.from(body as string, 'utf8'),
        resolvePublicKey: async () => publicKey,
        consumeNonce: async () => true,
      });

      expect(verifyResult.ok).toBe(true);
    });
  });

  it('submitPairing sends no signature headers at all (the one unsigned op -- no relation exists yet to sign with)', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce(
      jsonResponse(200, { status: 'code-expired' }),
    );
    const { publicKey } = generateKeyPairSync('ed25519');

    await submitPairing(PROXY_URI, {
      registrationCode: 'ABCDEF',
      growiUri: 'https://growi.example.com',
      growiLabel: 'My GROWI',
      publicKey: {
        keyId: 'growi-key-1',
        publicKeyJwk: publicKey.export({ format: 'jwk' }),
        validFrom: new Date().toISOString(),
      },
    });

    const [, , config = {}] = vi.mocked(axios.post).mock.calls[0];
    const headerNames = Object.keys(stringHeaders(config.headers)).map((h) =>
      h.toLowerCase(),
    );
    expect(headerNames).not.toContain('signature');
    expect(headerNames).not.toContain('signature-input');
    expect(headerNames).not.toContain('content-digest');
  });

  describe('a broken response is refused, not passed through', () => {
    it('notify: a response missing required NotificationResult fields is refused as malformed-response', async () => {
      const relationId = 'relation-malformed-notify';
      await setUpRelation(relationId);
      // Missing `status` on the one outcome -- not a valid NotificationResult.
      vi.mocked(axios.post).mockResolvedValueOnce(
        jsonResponse(200, {
          outcomes: [{ platform: 'slack', channelId: 'C1' }],
        }),
      );

      const outcome = await notify(relationId, {
        requestId: 'req-1',
        targets: [{ platform: 'slack', channelId: 'C1' }],
        markdown: 'hello',
        containsRestrictedPage: false,
      });

      expect(outcome).toEqual({ ok: false, reason: 'malformed-response' });
    });

    it('fetchCapabilities: a response that is not JSON at all is refused as malformed-response', async () => {
      const relationId = 'relation-malformed-capabilities';
      await setUpRelation(relationId);
      vi.mocked(axios.post).mockResolvedValueOnce({
        status: 200,
        data: 'not json at all {{{',
      });

      const outcome = await fetchCapabilities(relationId);

      expect(outcome).toEqual({ ok: false, reason: 'malformed-response' });
    });

    it('submitPairing: a response of the wrong shape is refused as malformed-response', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(
        jsonResponse(200, { status: 'not-a-real-status' }),
      );

      const { publicKey } = generateKeyPairSync('ed25519');
      const outcome = await submitPairing(PROXY_URI, {
        registrationCode: 'ABCDEF',
        growiUri: 'https://growi.example.com',
        growiLabel: 'My GROWI',
        publicKey: {
          keyId: 'growi-key-1',
          publicKeyJwk: publicKey.export({ format: 'jwk' }),
          validFrom: new Date().toISOString(),
        },
      });

      expect(outcome).toEqual({ ok: false, reason: 'malformed-response' });
    });
  });

  describe('other failure reasons', () => {
    it('refuses with unknown-relation when relationId names no chat_relations row', async () => {
      const outcome = await fetchCapabilities('relation-does-not-exist');
      expect(outcome).toEqual({ ok: false, reason: 'unknown-relation' });
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('refuses with no-signing-key when the relation has no currently-usable own key', async () => {
      const relationId = 'relation-no-own-key';
      await ChatRelation.create({
        relationId,
        proxyUri: PROXY_URI,
        platform: 'slack',
        workspaceId: 'workspace-1',
        workspaceName: 'Workspace One',
        label: null,
        state: 'active',
        settingsVersion: 0,
        createdAt: new Date(),
      });

      const outcome = await fetchCapabilities(relationId);
      expect(outcome).toEqual({ ok: false, reason: 'no-signing-key' });
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('refuses with http-error on a non-2xx status', async () => {
      const relationId = 'relation-http-error';
      await setUpRelation(relationId);
      vi.mocked(axios.post).mockResolvedValueOnce({ status: 500, data: '' });

      const outcome = await fetchCapabilities(relationId);
      expect(outcome).toEqual({ ok: false, reason: 'http-error' });
    });

    it('refuses with unreachable when the request itself fails', async () => {
      const relationId = 'relation-unreachable';
      await setUpRelation(relationId);
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const outcome = await fetchCapabilities(relationId);
      expect(outcome).toEqual({ ok: false, reason: 'unreachable' });
    });
  });

  it('sanity: every op this file sends is declared growi-to-proxy in the shared routing table (pairing-submit is deliberately absent, per op-names.ts)', () => {
    const sentOps = [
      OP_NAMES.notification,
      OP_NAMES.settingsPush,
      OP_NAMES.keyRegisterToProxy,
      OP_NAMES.keyRevokeToProxy,
      OP_NAMES.capabilities,
      OP_NAMES.connectionStatus,
      OP_NAMES.channels,
    ];
    for (const op of sentOps) {
      expect(OP_ENDPOINTS[op].direction).toBe('growi-to-proxy');
    }
  });
});
