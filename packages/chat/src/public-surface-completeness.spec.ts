import { describe, expect, it } from 'vitest';

import * as clientEntry from './index.js';
import * as serverEntry from './server.js';

// A typo'd or forgotten re-export in `src/index.ts` / `src/server.ts` would
// otherwise only surface as a downstream consumer (chat-integration-proxy /
// chat-integration-app) hitting `undefined` at import time. This asserts,
// symbol by symbol, that every VALUE this task's export lists claim exists
// really is defined at runtime. Type-only exports (interfaces, type
// aliases) have no runtime representation and are covered by `tsc`/`tsgo`
// type-checking instead -- listing them here would just assert `undefined`
// on purpose.

describe('src/index.ts (client-safe entry point) exports every claimed value', () => {
  it.each([
    'RESPONSE_KINDS',
    'COMMAND_NAMES',
    'COMMAND_TRAITS',
    'isWriteCommand',
    'targetingOf',
    'OP_ENDPOINTS',
    'OP_NAMES',
    'filterBroadcastTargets',
    'judge',
    'judgeGrowiUri',
    'parseAccountLinkStart',
    'parseAccountLinkStartResponse',
    'parseCapabilityReport',
    'parseChannelInventory',
    'parseCommandRequest',
    'parseCommandResponse',
    'parseConnectionStatusView',
    'parseKeyOperationResult',
    'parseKeyRegistration',
    'parseKeyRevocation',
    'parseNotificationRequest',
    'parseNotificationResult',
    'parseOpEnvelope',
    'parseOwnershipChallenge',
    'parsePairingResult',
    'parsePairingSubmission',
    'parseSettingsPullResponse',
    'parseSettingsPush',
    'parseChallengeResponse',
  ] as const)('exports %s', (name) => {
    expect((clientEntry as Record<string, unknown>)[name]).toBeDefined();
  });
});

describe('src/server.ts (server-only entry point) exports every claimed value', () => {
  it.each([
    'CLOCK_SKEW_TOLERANCE_SEC',
    'CONTENT_DIGEST_ALGORITHM',
    'COVERED_COMPONENTS',
    'DEFAULT_EXPIRES_IN_SEC',
    'MAX_ACCEPTED_EXPIRES_IN_SEC',
    'SIGNATURE_ALGORITHM',
    'SIGNATURE_LABEL',
    'SIGNATURE_PARAMS',
    'acceptEnvelope',
    'computeContentDigest',
    'decodeKeyId',
    'encodeKeyId',
    'isValidKeyIdShape',
    'isValidPublicKeyMaterial',
    'judgeKeyRevocation',
    'pairingChallengePayload',
    'sign',
    'verify',
  ] as const)('exports %s', (name) => {
    expect((serverEntry as Record<string, unknown>)[name]).toBeDefined();
  });
});
