/**
 * Response of `POST /_api/v3/ai-settings/refresh-model-catalog`. Declared once
 * here and shared by the route (server) and the admin UI (client) so the wire
 * contract cannot drift between the two layers.
 *
 * Carries only refresh metadata — the fetch timestamp and the per-provider
 * selectable-model counts. No secret information (API keys, provider
 * credentials, providerOptions) is ever included (Req 7.1); the refreshed model
 * ids themselves are served by GET /ai-settings/available-models.
 */
export interface RefreshModelCatalogResponse {
  /** ISO 8601 timestamp of the successful fetch from models.dev. */
  fetchedAt: string;
  /** provider → number of selectable model ids in the refreshed catalog. */
  counts: Record<string, number>;
}
