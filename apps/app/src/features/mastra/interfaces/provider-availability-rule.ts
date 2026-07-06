import type { AiProvider } from './ai-provider';
import type { AzureOpenaiConfig } from './azure-openai-config';

// The single per-provider availability predicate, extracted as a client-safe pure
// function so the rule has ONE definition. Both the server
// (provider-availability.ts, which supplies values read from config) and the admin
// client (which supplies live react-hook-form values) evaluate availability through
// this function, so the enabled-and-configured judgement — and in particular the
// non-uniform azure-openai rule — cannot drift between server and client.
//
// This module is intentionally dependency-free apart from the `AiProvider` and
// `AzureOpenaiConfig` types — both pure, client-safe interface modules (type-only
// imports, erased at build). It must stay importable from both the Next.js client
// bundle and the Express server. Do NOT add config, logger, or other server-only
// imports here.

/**
 * Why an enabled provider is nonetheless unavailable.
 * - `disabled`: the admin has not turned the provider on (enabled !== true). This
 *   is the administrator's intent, so callers do not surface it as a fault.
 * - `missing-api-key`: a key-required provider has no API key.
 * - `missing-azure-endpoint`: azure-openai has neither resourceName nor baseURL.
 */
export type ProviderUnavailableReason =
  | 'disabled'
  | 'missing-api-key'
  | 'missing-azure-endpoint';

export type ProviderAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: ProviderUnavailableReason };

export interface ProviderAvailabilityInput {
  readonly provider: AiProvider;
  readonly enabled: boolean;
  readonly hasApiKey: boolean;
  /**
   * Only consulted for the 'azure-openai' provider. Picked from AzureOpenaiConfig
   * (its single source of truth) so a field rename there is a compile error here,
   * not a silent drift; `apiVersion` is omitted because availability never reads it.
   */
  readonly azureOpenaiSettings?: Readonly<
    Pick<AzureOpenaiConfig, 'resourceName' | 'baseURL' | 'useEntraId'>
  >;
}

// A blank ('' / whitespace / undefined) value counts as "not set". The server reads
// config values (undefined when unset) and the client reads controlled form fields
// (which default to ''), so both must treat a blank string the same as absent.
const isNonBlank = (value?: string): boolean => (value ?? '').trim() !== '';

/**
 * Pure availability rule shared by the server (provider-availability.ts, which
 * supplies values read from config) and the admin client (which supplies live
 * form values). A blank ('' / whitespace / undefined) endpoint counts as absent.
 *
 * azure-openai is the one non-uniform provider: it needs an endpoint (resourceName
 * or baseURL) regardless of auth method, and its API key is waived under Microsoft
 * Entra ID (ambient managed identity). The endpoint is checked FIRST, so a
 * key-present-but-endpoint-missing deployment reads as missing-azure-endpoint, not
 * missing-api-key — mirroring the resolver's real success/throw path.
 */
export const evaluateProviderAvailability = (
  input: ProviderAvailabilityInput,
): ProviderAvailability => {
  const { provider, enabled, hasApiKey, azureOpenaiSettings } = input;

  if (!enabled) {
    return { available: false, reason: 'disabled' };
  }

  if (provider === 'azure-openai') {
    const hasEndpoint =
      isNonBlank(azureOpenaiSettings?.resourceName) ||
      isNonBlank(azureOpenaiSettings?.baseURL);
    if (!hasEndpoint) {
      return { available: false, reason: 'missing-azure-endpoint' };
    }
    if (azureOpenaiSettings?.useEntraId !== true && !hasApiKey) {
      return { available: false, reason: 'missing-api-key' };
    }
    return { available: true };
  }

  // Key-based providers (openai / anthropic / google) require only an API key.
  if (!hasApiKey) {
    return { available: false, reason: 'missing-api-key' };
  }

  return { available: true };
};
