// The notification request/result contract, GROWI -> proxy direction
// (Requirement 2). Unlike CommandRequest/CommandResponse (task 3.1), this
// is a one-way fan-out to a list of channels, so the shapes here center on
// per-target outcomes rather than a single discriminated response.

import type { OP_NAMES, RequestEnvelope } from '../endpoints/op-names.js';
import type { PlatformName } from './common.js';

/** GROWI → proxy. Notification body travels as a markdown string (Decision 3). */
export interface NotificationRequest extends RequestEnvelope {
  readonly op: typeof OP_NAMES.notification;
  readonly requestId: string;
  /**
   * Specified by channelId. The proxy confirms the target belongs to that
   * relation's installation (Requirement 2.1, 2.2).
   */
  readonly targets: ReadonlyArray<{
    readonly platform: PlatformName;
    readonly channelId: string;
  }>;
  readonly markdown: string;
  /** Requirement 2.3: GROWI makes this judgement, not the proxy. */
  readonly containsRestrictedPage: boolean;
}

/**
 * Per-target result. Requirement 2.4 wants "something an operator can check
 * after the fact"; an official-proxy user can't see proxy's own logs, so
 * results are returned to GROWI to record. `timeout` exists so a large
 * target list doesn't block GROWI's single request indefinitely -- proxy
 * enforces its own deadline too.
 */
export interface NotificationResult {
  /**
   * ALWAYS returns one entry per full `targets` list, every time -- including
   * retries. A retry that already succeeded for some targets must still
   * report those as `posted`; returning "only the targets tried this time"
   * would erase the previous success when GROWI writes the result back into
   * its outbox row.
   */
  readonly outcomes: ReadonlyArray<{
    readonly platform: PlatformName;
    readonly channelId: string;
    /**
     * `inventory-not-ready` means "proxy hasn't fetched the channel list
     * yet", NOT "no such channel" -- conflating it with
     * `channel-not-in-installation` would guide an operator to the wrong
     * fix (Requirement 2.4).
     */
    readonly status:
      | 'posted'
      | 'bot-not-in-channel'
      | 'channel-not-in-installation'
      | 'inventory-not-ready'
      | 'platform-error'
      | 'timeout';
    readonly remedy?: string;
    readonly detail?: string;
  }>;
}
