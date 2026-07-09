import type { AiProvider } from './ai-provider';
import type { ModelKey } from './model-key';

/**
 * One selectable model in the chat selector. `key` is the opaque composite
 * identifier the client sends back (POST message) and persists
 * (`UserUISettings.aiChatSelectedModelKey`); `provider` and `modelId` are for
 * display only (the selector groups entries by provider — Req 4.2 — and shows
 * the raw modelId, which has no friendly name).
 */
export interface ChatModelEntry {
  key: ModelKey;
  provider: AiProvider;
  modelId: string;
}

/**
 * Response of `GET /_api/v3/mastra/models`. Declared once here and shared by the
 * route (server) and the SWR hook (client) so the wire contract cannot drift
 * between the two layers.
 *
 * `models` contains only models of available (enabled AND configured) providers,
 * in allow-list order.
 *
 * `selectedModelKey` is the model the chat selector should start on: the user's
 * persisted choice when it is still in the available set, otherwise the
 * effective default. It is validated server-side (Req 4.4, 4.5) so the client
 * trusts it as-is. Always present: the route runs only once AI is configured
 * (a non-empty available set, hence an effective default), so a selection
 * always exists.
 *
 * providerOptions are server-only and MUST NOT be sent (Security).
 */
export interface ChatModelsResponse {
  models: ChatModelEntry[];
  selectedModelKey: ModelKey;
}
