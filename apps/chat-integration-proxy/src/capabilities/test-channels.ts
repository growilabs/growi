// Test fixture, not production surface (excluded from `tsconfig.build.json`,
// like `db/repositories/test-cipher.ts`): channel ids in the form an event
// carries them, built through the validating constructor. Here rather than in
// `testing/` so specs in every layer can use it.
//
// The encodings mirror the installed adapters; `platform/channels.spec.ts`
// pins the real ones, which only `platform/` may import.
import type { PlatformName } from '@growi/chat';

import type { SdkChannelId, SdkChannelRef } from '../types/index.js';
import { toSdkChannelId } from './channel-id.js';

const DISCORD_GUILD_ID = '700000000000000001';
const TEAMS_SERVICE_URL = 'https://smba.trafficmanager.net/teams/';

const base64url = (value: string): string =>
  Buffer.from(value).toString('base64url');

const ENCODINGS: Readonly<Record<PlatformName, (nativeId: string) => string>> =
  {
    slack: (nativeId) => `slack:${nativeId}`,
    discord: (nativeId) => `discord:${DISCORD_GUILD_ID}:${nativeId}`,
    teams: (nativeId) =>
      `teams:${base64url(nativeId)}:${base64url(TEAMS_SERVICE_URL)}`,
    mattermost: (nativeId) => nativeId,
  };

/** The id an event in the channel the service shows as `nativeId` carries. */
export const testSdkChannelId = (
  platform: PlatformName,
  nativeId: string,
): SdkChannelId => toSdkChannelId(platform, ENCODINGS[platform](nativeId));

/** A channel as events name it; `C1` on every service unless overridden. */
export const testSdkChannel = (
  platform: PlatformName,
  overrides: Partial<Omit<SdkChannelRef, 'platform'>> = {},
): SdkChannelRef => ({
  platform,
  channelId: testSdkChannelId(platform, 'C1'),
  channelName: 'general',
  isPrivate: false,
  ...overrides,
});
