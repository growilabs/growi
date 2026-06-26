import type S2sMessage from '~/server/models/vo/s2s-message';
import type { S2sMessageHandlable } from '~/server/service/s2s-messaging/handlable';

import { clearResolvedMastraModelCache } from './ai-sdk-modules/resolve-mastra-model';

// Subscribes to the `configUpdated` s2s message so that a settings update on
// another instance discards this instance's memoized Mastra model, giving
// restart-free reflection of AI setting changes across the cluster (Req 2.4).
// `configManager.updateConfigs` does not deliver to the publishing instance, so
// the local clear (in the PUT handler) and this remote clear are both required.
//
// No freshness guard (unlike ConfigManager): `configUpdated` fires on every
// config update, so this over-invalidates for non-AI updates, but clearing the
// cache only forces a one-time rebuild on the next request and is idempotent —
// the cost is negligible and config changes are rare (see design.md
// model-config-sync Risks).
class ModelConfigSync implements S2sMessageHandlable {
  shouldHandleS2sMessage(s2sMessage: S2sMessage): boolean {
    return s2sMessage.eventName === 'configUpdated';
  }

  // Clearing the cache is synchronous, but the S2sMessageHandlable contract
  // requires a Promise return, so resolve immediately.
  handleS2sMessage(): Promise<void> {
    clearResolvedMastraModelCache();
    return Promise.resolve();
  }
}

// Module-level singleton, mirroring how `configManager` is registered as a
// handler in crowi's setupS2sMessagingService().
export const modelConfigSync = new ModelConfigSync();
