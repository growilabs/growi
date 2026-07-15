/**
 * One selectable model on the wire: the bare model id plus its official display
 * name (from the catalog; the id itself when models.dev carried no name). Kept
 * structurally identical to the server-side ModelCatalogEntry so the route can
 * return catalog entries directly, but declared here (not imported from server
 * code) so the shared interface stays server-free for the client bundle.
 */
export interface SelectableModel {
  id: string;
  name: string;
}

/**
 * Response of `GET /_api/v3/ai-settings/available-models`. Declared once here and
 * shared by the route (server) and the SWR hook (client) so the wire contract
 * cannot drift between the two layers.
 *
 * `models` is the id+name array narrowed to chat + tool-capable models by the
 * catalog filter (applied identically at vendoring time and on a runtime refresh;
 * empty for providers without a catalog, e.g. azure-openai). No secret information
 * (API keys, provider credentials, providerOptions) is ever included — only model
 * id/display-name information (Req 7.1).
 */
export interface SelectableModelsResponse {
  models: SelectableModel[];
}
