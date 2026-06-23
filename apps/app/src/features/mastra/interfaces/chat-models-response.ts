/**
 * Response of `GET /_api/v3/mastra/models`. Declared once here and shared by the
 * route (server) and the SWR hook (client) so the wire contract cannot drift
 * between the two layers.
 *
 * `modelIds` is the allow-list of selectable model ids (the deployment name for the
 * azure-openai provider). No display name is sent: the ids have no friendly name,
 * so the selector renders the id itself.
 *
 * `selectedModelId` is the model the chat selector should start on: the user's
 * persisted choice (`UserUISettings.aiChatSelectedModelId`) when it is still in the
 * allow-list, otherwise the configured default. It is validated server-side
 * (Req 3.2/3.7) so the client trusts it as-is. Always present: the route runs only
 * once AI is configured (a non-empty allow-list, hence a default), so a selection
 * always exists.
 *
 * providerOptions are server-only and MUST NOT be sent (Security).
 */
export interface ChatModelsResponse {
  modelIds: string[];
  selectedModelId: string;
}
