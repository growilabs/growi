/**
 * Response of `GET /_api/v3/ai-settings/available-models`. Declared once here and
 * shared by the route (server) and the SWR hook (client) so the wire contract
 * cannot drift between the two layers.
 *
 * `modelIds` is the bare id array narrowed to chat + tool-capable models by the
 * catalog filter (applied identically at vendoring time and on a runtime refresh;
 * empty for providers without a catalog, e.g. azure-openai). No secret information
 * (API keys, provider credentials, providerOptions) is ever included — only model
 * id information (Req 7.1).
 */
export interface SelectableModelsResponse {
  modelIds: string[];
}
