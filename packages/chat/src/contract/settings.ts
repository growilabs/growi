// The relation-scoped settings contract: per-command channel permissions,
// the push/pull round trip that keeps proxy's copy current (Requirement
// 11.4), capability reporting (Requirement 1.3), connection health
// (Requirement 1.4), and the channel inventory the admin screen picks
// notification targets from (Requirement 2.2, 11.1).

import type { CommandName } from '../commands/command-names.js';
import type { OP_NAMES, RequestEnvelope } from '../endpoints/op-names.js';
import type { PlatformName } from './common.js';

/**
 * Meaning of `allowedChannels`:
 *   'all'  … allowed in every channel
 *   'none' … allowed in no channel
 *   array  … allowed only in the listed channelIds (match by id, NEVER by name)
 */
export interface RelationSettings {
  readonly relationId: string;
  /**
   * ONE ROW PER COMMAND. `scope` (broadcast vs single-target) is NOT stored
   * per-row -- that's already determined by COMMAND_TRAITS.targeting, so
   * storing it again here would duplicate the same knowledge in two places,
   * and when the two disagree there'd be no way to know which one to trust.
   */
  readonly channelPermissions: ReadonlyArray<{
    readonly commandName: CommandName;
    readonly allowedChannels: ReadonlyArray<string> | 'all' | 'none';
  }>;
}

/**
 * Connection health (Req 1.4). Cross-cuts both sides, so it lives here.
 * Do NOT return ConnectionManager.status()'s internal shape directly --
 * internally there's a healthy state called `held-by-other` (another
 * instance holds the connection), but mapping that to "disconnected" would
 * make a multi-instance deployment show "abnormal" every time a non-owning
 * instance answers.
 */
export type ConnectionHealth =
  | 'connected' // some instance holds it and it's healthy (held-by-other maps here too)
  | 'reconnecting'
  | 'failed' // this is what Req 1.4 actually wants to surface
  | 'not-applicable'; // a service with no persistent connection (Teams)

export interface ConnectionStatusView {
  readonly platform: PlatformName;
  readonly health: ConnectionHealth;
  readonly since: string;
}

/**
 * GROWI → proxy. Pushed the moment an admin saves settings. Satisfies
 * Req 11.4 ("takes effect from the next execution").
 */
export interface SettingsPushRequest extends RequestEnvelope {
  readonly op: typeof OP_NAMES.settingsPush;
  readonly settings: RelationSettings;
  /**
   * Settings version. ONE VALUE PER RELATION, not per row (the whole
   * settings object is sent wholesale every time, so a per-row version
   * would have no comparison basis). GROWI increments by 1 on every save.
   * proxy DISCARDS any push whose version is smaller than what it already
   * has. Without this, if an admin makes 2 changes in a row and the first
   * change's retry arrives late, the OLD settings silently overwrite the
   * NEW ones (proxy has no way to detect it). Touches Req 11.4.
   *
   * MUST NOT be a timestamp. If the clock goes backward, a newer setting
   * gets discarded; if two consecutive changes land on the same timestamp,
   * the second one gets discarded. Both look normal from proxy's side and
   * are unreachable by root-causing.
   */
  readonly version: number;
}

/** proxy → GROWI (fallback). proxy fetches this if the push never arrived. */
export interface SettingsPullResponse {
  readonly settings: RelationSettings;
  /** GROWI's own settings version. proxy replaces its copy if this is larger than what it has. */
  readonly version: number;
}

/**
 * proxy → GROWI. Admin screen fetches this to pick notification targets
 * (Req 2.2 / 11.1). channelName is available here so Req 12.4's
 * target-overlap matching can use it too.
 */
export interface ChannelInventory {
  readonly channels: ReadonlyArray<{
    readonly platform: PlatformName;
    readonly channelId: string;
    readonly channelName: string;
    readonly isPrivate: boolean;
  }>;
}

export type CapabilityLevel = 'full' | 'degraded' | 'none' | 'unverified';

/** proxy → GROWI. Admin screen fetches this to show "what works on this service" (Req 1.3) */
export interface CapabilityReport {
  readonly platforms: ReadonlyArray<{
    readonly platform: PlatformName;
    readonly capabilities: ReadonlyArray<{
      readonly capability: string;
      readonly level: CapabilityLevel;
      readonly substitute: string | null;
    }>;
  }>;
}
