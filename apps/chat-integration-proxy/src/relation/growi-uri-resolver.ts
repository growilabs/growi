// The proxy's half of the check on a GROWI URI a chat workspace declared
// (Requirements 9.2, 13.1). design.md, "申告された URL の検証は 2 つに割れている":
//
//   - **Judging the conditions** (https, default port, resolved address outside
//     the private ranges) belongs to `@growi/chat`'s `judgeGrowiUri`, which
//     touches no network and is not re-implemented here.
//   - **Resolving the name, connecting to the address that was judged, refusing
//     redirects and capping the wait** belongs to this file.
//
// Two properties are the point of the split:
//
//   - **The judgement runs on every request to a stored `growi_uri`, not only
//     at pairing time.** Judging once would let an operator declare a public
//     address, pass, and then point the name at a closed-network host -- the
//     exact move the check exists to stop.
//   - **The connection goes to the address that was just judged.** Letting the
//     socket resolve the name a second time would leave a window in which the
//     judged address and the connected address differ.
//
// `GrowiClient` (`growi/growi-client.ts`) must reach GROWI only through this
// module. A second place that builds HTTP requests is a second place the
// judgement can be missing from.

import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import type { RequestOptions } from 'node:https';
import { request as httpsRequest } from 'node:https';
import { judgeGrowiUri } from '@growi/chat';

import type { ClosedNetworkConfig } from '../types/index.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * `judgeGrowiUri`'s four reasons, plus the one it can never produce: it is
 * handed addresses that were already resolved, so a name that resolves to
 * nothing is this module's own outcome to report.
 */
export type GrowiUriRejectionReason =
  | 'scheme'
  | 'port'
  | 'private-address'
  | 'malformed'
  | 'dns-failure';

export interface GrowiHttpRequest {
  readonly method: string;
  /** Path and query, read relative to the GROWI URI's own path. */
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface GrowiHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | ReadonlyArray<string>>>;
  readonly body: string;
}

/**
 * One connection to a GROWI whose URI has just been judged, pinned to the
 * addresses that judgement saw. Held only for the length of one exchange --
 * keeping it longer would turn it back into a judgement made once and reused.
 */
export type PinnedConnection = (
  request: GrowiHttpRequest,
) => Promise<GrowiHttpResponse>;

export type ConnectResult =
  | { readonly ok: true; readonly send: PinnedConnection }
  | { readonly ok: false; readonly reason: GrowiUriRejectionReason };

export interface GrowiUriResolver {
  /**
   * Resolves `growiUri`'s name (re-resolving unless a recent answer is still
   * held), judges what came back, and only then hands out a connection bound
   * to those addresses -- so no caller can judge one address and connect to
   * another.
   */
  connect(growiUri: string): Promise<ConnectResult>;
}

export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

/** Name resolution, as a parameter so tests never touch a real resolver. */
export type ResolveAddresses = (
  hostname: string,
) => Promise<ReadonlyArray<ResolvedAddress>>;

/** Raised when a destination does not finish answering inside the wait cap. */
export class GrowiRequestTimeoutError extends Error {
  constructor(uri: string, timeoutMs: number) {
    super(`${uri} did not answer within ${timeoutMs}ms.`);
    this.name = 'GrowiRequestTimeoutError';
  }
}

export interface GrowiUriResolverDeps {
  readonly closedNetwork: ClosedNetworkConfig;
  /**
   * How long a resolved address may be reused. A search reaches every linked
   * GROWI at once, so resolving on every single request would multiply one
   * search into as many resolutions as there are relations. The cost of the
   * window is that a name pointed somewhere else is noticed up to this late --
   * incomparably smaller than judging only at pairing time, which never
   * notices at all (design.md: 「引いた結果は短い時間だけ覚える（既定 30 秒）」).
   */
  readonly cacheTtlMs?: number;
  /** Cap on how long one exchange may take, start to finish. */
  readonly requestTimeoutMs?: number;
  readonly lookup?: ResolveAddresses;
  readonly now?: () => number;
}

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Building the request
// ---------------------------------------------------------------------------

export interface PinnedRequestParams {
  readonly uri: URL;
  readonly request: GrowiHttpRequest;
  /** Every address the judgement passed. */
  readonly addresses: ReadonlyArray<ResolvedAddress>;
  readonly caCerts: ReadonlyArray<string>;
  readonly timeoutMs: number;
}

/**
 * The options one exchange is made with. Pure, so what "pinned" means is
 * checkable without opening a socket.
 *
 * `host` stays the hostname the URI wrote and only `lookup` is overridden.
 * Node then derives the TLS server name, the certificate identity check and
 * the `Host` header from that hostname on its own -- writing the address into
 * `host` instead would mean rebuilding all three by hand, and getting the
 * certificate identity check wrong there is not visible until a real
 * certificate is presented.
 */
/**
 * The base a GROWI's own paths hang off: its URI's `pathname`, always ending
 * in `/`. Shared with `growi-selection.ts`'s URL matching -- both need a
 * GROWI served under a prefix (`https://example.com/growi/`) resolved by the
 * same rule, one to build a request path relative to it, the other to
 * recognise a posted URL as belonging to it.
 */
export const growiBasePathOf = (uri: URL): string =>
  uri.pathname.endsWith('/') ? uri.pathname : `${uri.pathname}/`;

export const buildPinnedRequestOptions = (
  params: PinnedRequestParams,
): RequestOptions => {
  const { uri, request, addresses, caCerts, timeoutMs } = params;

  // A path is read relative to the GROWI URI's own path, so a GROWI served
  // under a prefix (`https://example.com/growi/`) keeps it. Taking only
  // `pathname`/`search` off the result also means a caller cannot move the
  // exchange to another host by writing a whole URL here.
  const basePath = growiBasePathOf(uri);
  const target = new URL(
    request.path.replace(/^\/+/, ''),
    new URL(basePath, uri),
  );

  return {
    protocol: uri.protocol,
    host: uri.hostname,
    port: uri.port === '' ? (uri.protocol === 'https:' ? 443 : 80) : uri.port,
    method: request.method,
    path: `${target.pathname}${target.search}`,
    headers: { ...request.headers },
    // The socket's own inactivity timer. It is NOT the cap this module
    // promises: nothing listens for its `'timeout'` event, and a destination
    // that dribbles bytes would keep resetting it. `performRequest`'s deadline
    // over the whole exchange is what actually ends a request.
    timeout: timeoutMs,
    // No connection pool: a socket kept alive past this exchange would outlive
    // the judgement that allowed it.
    agent: false,
    // Only the operator-declared certificates are added, and only when there
    // are any: `ca: []` would replace Node's root store with an empty one, and
    // every ordinary https destination would fail with a certificate error
    // that says nothing about the cause.
    ...(caCerts.length > 0 ? { ca: [...caCerts] } : {}),
    // Pinning to the whole set rather than to one address is safe because
    // `judgeGrowiUri` refuses unless EVERY resolved address is public -- and it
    // keeps the IPv4/IPv6 fallback that a single address would remove.
    lookup: (_hostname, options, callback) => {
      if (options.all === true) {
        callback(
          null,
          addresses.map((a) => ({ ...a })),
        );
        return;
      }
      const first = addresses[0];
      callback(null, first.address, first.family);
    },
  };
};

const performRequest = (
  uri: URL,
  options: RequestOptions,
  body: string | undefined,
  timeoutMs: number,
): Promise<GrowiHttpResponse> =>
  new Promise((resolve, reject) => {
    // `http`/`https` never follow a redirect on their own, which is the
    // behaviour wanted here: a 3xx is handed back as the answer it is, so a
    // destination cannot walk the proxy somewhere the judgement never saw.
    const send = uri.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(options);

    // One deadline over the whole exchange, not per idle socket: a destination
    // that dribbles a byte at a time would keep a socket-idle timer from ever
    // firing.
    const deadline = setTimeout(() => {
      req.destroy(new GrowiRequestTimeoutError(uri.href, timeoutMs));
    }, timeoutMs);
    const settle = <T>(finish: (value: T) => void) => {
      return (value: T): void => {
        clearTimeout(deadline);
        finish(value);
      };
    };
    const fail = settle(reject);

    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('error', fail);
      res.on(
        'end',
        settle(() => {
          const headers: Record<string, string | ReadonlyArray<string>> = {};
          for (const [name, value] of Object.entries(res.headers)) {
            if (value != null) {
              headers[name] = value;
            }
          }
          resolve({
            status: res.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        }),
      );
    });
    req.on('error', fail);

    if (body != null) {
      req.write(body);
    }
    req.end();
  });

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

interface CachedAddresses {
  readonly addresses: ReadonlyArray<ResolvedAddress>;
  readonly expiresAt: number;
}

/**
 * `dns.lookup` carries no deadline of its own -- the operating system's
 * resolver bounds this phase, not `requestTimeoutMs`, which starts when the
 * exchange does.
 */
const defaultLookup: ResolveAddresses = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

export const createGrowiUriResolver = (
  deps: GrowiUriResolverDeps,
): GrowiUriResolver => {
  const {
    closedNetwork,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    lookup = defaultLookup,
    now = Date.now,
  } = deps;

  const cache = new Map<string, CachedAddresses>();

  const addressesFor = async (
    hostname: string,
  ): Promise<ReadonlyArray<ResolvedAddress>> => {
    const remembered = cache.get(hostname);
    if (remembered != null && remembered.expiresAt > now()) {
      return remembered.addresses;
    }

    const addresses = await lookup(hostname);
    cache.set(hostname, { addresses, expiresAt: now() + cacheTtlMs });
    return addresses;
  };

  return {
    connect: async (growiUri: string): Promise<ConnectResult> => {
      let uri: URL;
      try {
        uri = new URL(growiUri);
      } catch {
        // Nothing to resolve, and the same reason `judgeGrowiUri` gives for a
        // URI it cannot read.
        return { ok: false, reason: 'malformed' };
      }
      if (uri.hostname === '') {
        return { ok: false, reason: 'malformed' };
      }

      let addresses: ReadonlyArray<ResolvedAddress>;
      try {
        addresses = await addressesFor(uri.hostname);
      } catch {
        return { ok: false, reason: 'dns-failure' };
      }

      // Judged on this call, against these addresses -- a caller cannot reach a
      // connection without passing through here first.
      const verdict = judgeGrowiUri(
        growiUri,
        addresses.map((resolved) => resolved.address),
        closedNetwork.allowList,
      );
      if (!verdict.ok) {
        return { ok: false, reason: verdict.reason };
      }
      if (addresses.length === 0) {
        // Only an allow-listed destination reaches this line: `judgeGrowiUri`
        // refuses an empty resolution otherwise. There is still nothing to
        // connect to.
        return { ok: false, reason: 'dns-failure' };
      }

      const caCerts = closedNetwork.trustedCaCertsFor(uri.hostname);
      return {
        ok: true,
        send: (request: GrowiHttpRequest) =>
          performRequest(
            uri,
            buildPinnedRequestOptions({
              uri,
              request,
              addresses,
              caCerts,
              timeoutMs: requestTimeoutMs,
            }),
            request.body,
            requestTimeoutMs,
          ),
      };
    },
  };
};
