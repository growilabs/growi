import type S2sMessage from '~/server/models/vo/s2s-message';
import type { S2sMessageHandlable } from '~/server/service/s2s-messaging/handlable';

import { clearAvailabilityLogDedup } from './ai-sdk-modules/llm-providers/warn-dedup';
import { clearResolvedMastraModelCache } from './ai-sdk-modules/resolved-model-cache';

// Subscribes to the `configUpdated` s2s message so that a settings update on
// another instance (a) discards this instance's memoized Mastra model and (b)
// resets the availability/malformed-config log dedup — giving restart-free
// reflection of AI setting changes across the cluster (Req 2.4) and re-notifying
// any remaining misconfiguration cluster-wide (Req 6.1). This mirrors the two
// clears the PUT handler runs locally; `configManager.updateConfigs` does not
// deliver to the publishing instance, so both the local clears and these remote
// clears are required.
//
// No freshness guard (unlike ConfigManager): `configUpdated` fires on every
// config update, so this over-invalidates for non-AI updates, but the resets only
// force a one-time rebuild / re-log on the next request and are idempotent — the
// cost is negligible and config changes are rare (see design.md
// model-config-sync Risks).
class ModelConfigSync implements S2sMessageHandlable {
  shouldHandleS2sMessage(s2sMessage: S2sMessage): boolean {
    return s2sMessage.eventName === 'configUpdated';
  }

  // Both resets are synchronous, but the S2sMessageHandlable contract requires a
  // Promise return, so resolve immediately.
  handleS2sMessage(): Promise<void> {
    clearResolvedMastraModelCache();
    clearAvailabilityLogDedup();
    return Promise.resolve();
  }
}

// Module-level singleton, mirroring how `configManager` is registered as a
// handler in crowi's setupS2sMessagingService().
export const modelConfigSync = new ModelConfigSync();
