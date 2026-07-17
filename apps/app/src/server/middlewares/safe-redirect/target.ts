/**
 * Pure decision logic for `res.safeRedirect` (see ./safe-redirect).
 *
 * Extracted from the middleware so the open-redirect rules and the reverse-proxy
 * handling are unit-testable without Express or the config manager. The middleware
 * stays a thin adapter that gathers the context and calls resolveSafeRedirect().
 */

export type SafeRedirectDisposition =
  | 'empty' // no redirectTo → root
  | 'local' // same host as the request or the configured site URL
  | 'whitelisted' // external but explicitly allowed
  | 'blocked' // external and not allowed → root (open redirect prevented)
  | 'invalid'; // redirectTo could not be parsed → root

export interface SafeRedirectContext {
  /** req.protocol — may be wrong (http) behind a proxy without `trust proxy`. */
  readonly reqProtocol: string;
  /** req.get('host') — the Host header, which may omit the public port. */
  readonly reqHost: string;
  /** req.hostname — host without port. */
  readonly reqHostname: string;
  /** app:siteUrl config value; when set it is the trusted canonical origin. */
  readonly appSiteUrl?: string | null;
  readonly whitelistOfHosts: readonly string[];
}

export interface SafeRedirectResolution {
  readonly target: string;
  readonly disposition: SafeRedirectDisposition;
}

const originOf = (url: string | null | undefined): string | null => {
  if (url == null || url === '') {
    return null;
  }
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

const isInWhitelist = (
  whitelistOfHosts: readonly string[],
  redirectToFqdn: string,
): boolean => {
  if (whitelistOfHosts == null || whitelistOfHosts.length === 0) {
    return false;
  }
  try {
    const url = new URL(redirectToFqdn);
    return (
      whitelistOfHosts.includes(url.hostname) ||
      whitelistOfHosts.includes(url.host)
    );
  } catch {
    return false;
  }
};

export const resolveSafeRedirect = (
  redirectTo: string | undefined,
  ctx: SafeRedirectContext,
): SafeRedirectResolution => {
  if (redirectTo == null) {
    return { target: '/', disposition: 'empty' };
  }

  // Prefer the configured site URL as the base so the emitted redirect keeps the
  // correct scheme/host/port even behind a TLS-terminating reverse proxy without
  // `trust proxy` (where req.protocol would be http and the Host header may drop the
  // public port). Fall back to the request-derived origin when app:siteUrl is unset.
  // See issue #11248.
  const configuredOrigin = originOf(ctx.appSiteUrl);
  const requestOrigin = `${ctx.reqProtocol}://${ctx.reqHost}`;
  const baseUrl = configuredOrigin ?? requestOrigin;

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(redirectTo, baseUrl);
  } catch {
    return { target: '/', disposition: 'invalid' };
  }

  // A redirect is local when its host matches the request host OR the configured site
  // host — both are trusted. Re-resolving the local path against baseUrl canonicalises
  // it to the configured origin (correct scheme/port) when app:siteUrl is set.
  const localHostnames = [ctx.reqHostname];
  if (configuredOrigin != null) {
    localHostnames.push(new URL(configuredOrigin).hostname);
  }
  if (localHostnames.includes(redirectUrl.hostname)) {
    const localPath = `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`;
    return { target: new URL(localPath, baseUrl).href, disposition: 'local' };
  }

  if (isInWhitelist(ctx.whitelistOfHosts, redirectTo)) {
    return { target: redirectTo, disposition: 'whitelisted' };
  }

  return { target: '/', disposition: 'blocked' };
};
