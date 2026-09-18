import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClosedNetworkConfig } from '../types/index.js';
import {
  buildPinnedRequestOptions,
  createGrowiUriResolver,
  GrowiRequestTimeoutError,
  type ResolveAddresses,
} from './growi-uri-resolver.js';

const noClosedNetwork: ClosedNetworkConfig = {
  allowList: [],
  trustedCaCertsFor: () => [],
};

const closedNetwork = (
  allowList: ReadonlyArray<string>,
  certs: Readonly<Record<string, ReadonlyArray<string>>> = {},
): ClosedNetworkConfig => ({
  allowList,
  trustedCaCertsFor: (hostname) => certs[hostname] ?? [],
});

/** A fake name resolution that records how many times it was consulted. */
const lookupReturning = (
  ...results: ReadonlyArray<ReadonlyArray<{ address: string; family: number }>>
): ResolveAddresses & { calls: string[] } => {
  const calls: string[] = [];
  const fake = (hostname: string) => {
    calls.push(hostname);
    // The last declared result stands for every further call.
    return Promise.resolve(
      results[Math.min(calls.length - 1, results.length - 1)],
    );
  };
  return Object.assign(fake, { calls });
};

const publicAddress = [{ address: '93.184.216.34', family: 4 }];
const privateAddress = [{ address: '10.0.0.7', family: 4 }];

describe('createGrowiUriResolver: judgement', () => {
  it('resolves the name and accepts a public https destination', async () => {
    const lookup = lookupReturning(publicAddress);
    const resolver = createGrowiUriResolver({
      closedNetwork: noClosedNetwork,
      lookup,
    });

    const result = await resolver.connect('https://growi.example.com/');

    expect(result.ok).toBe(true);
    expect(lookup.calls).toEqual(['growi.example.com']);
  });

  it('refuses a URI that names no host, without resolving anything', async () => {
    const lookup = lookupReturning(publicAddress);
    const resolver = createGrowiUriResolver({
      closedNetwork: noClosedNetwork,
      lookup,
    });

    const result = await resolver.connect('not a uri');

    expect(result).toEqual({ ok: false, reason: 'malformed' });
    expect(lookup.calls).toEqual([]);
  });

  it('refuses an allow-listed destination that resolves to no address at all', async () => {
    // Only an allow-listed host can reach this branch -- `judgeGrowiUri`
    // itself refuses an empty resolution as `private-address` otherwise.
    // There is still nothing to connect to, so this must not fall through to
    // `buildPinnedRequestOptions`'s unguarded `addresses[0]`.
    const lookup = lookupReturning([]);
    const resolver = createGrowiUriResolver({
      closedNetwork: closedNetwork(['growi.internal']),
      lookup,
    });

    const result = await resolver.connect('https://growi.internal/');

    expect(result).toEqual({ ok: false, reason: 'dns-failure' });
  });

  it('refuses a destination whose name resolves into a private range', async () => {
    const resolver = createGrowiUriResolver({
      closedNetwork: noClosedNetwork,
      lookup: lookupReturning(privateAddress),
    });

    expect(await resolver.connect('https://growi.example.com/')).toEqual({
      ok: false,
      reason: 'private-address',
    });
  });

  it('refuses cleanly when the name cannot be resolved at all', async () => {
    const failing: ResolveAddresses = () =>
      Promise.reject(
        Object.assign(new Error('getaddrinfo ENOTFOUND'), {
          code: 'ENOTFOUND',
        }),
      );
    const resolver = createGrowiUriResolver({
      closedNetwork: noClosedNetwork,
      lookup: failing,
    });

    expect(await resolver.connect('https://growi.example.com/')).toEqual({
      ok: false,
      reason: 'dns-failure',
    });
  });

  it('accepts a closed-network destination the operator declared', async () => {
    const resolver = createGrowiUriResolver({
      closedNetwork: closedNetwork(['growi.internal']),
      lookup: lookupReturning(privateAddress),
    });

    expect((await resolver.connect('http://growi.internal:3000/')).ok).toBe(
      true,
    );
  });

  // The acceptance bullet of task 5.1: the judgement is not something a first
  // successful pairing buys once. Both assertions below are needed -- that the
  // second call is judged, AND that it was judged against the addresses still
  // held in the cache (the resolution count does not move).
  it('judges every call, including one served from the address cache', async () => {
    const lookup = lookupReturning(publicAddress);
    const resolver = createGrowiUriResolver({
      closedNetwork: noClosedNetwork,
      lookup,
    });

    expect((await resolver.connect('https://growi.example.com/')).ok).toBe(
      true,
    );
    expect(await resolver.connect('https://growi.example.com:8443/')).toEqual({
      ok: false,
      reason: 'port',
    });
    expect(await resolver.connect('http://growi.example.com/')).toEqual({
      ok: false,
      reason: 'scheme',
    });
    expect(lookup.calls).toEqual(['growi.example.com']);
  });

  it('resolves the name again once the remembered addresses are older than the cache window', async () => {
    const lookup = lookupReturning(publicAddress, privateAddress);
    let clock = 1_000;
    const resolver = createGrowiUriResolver({
      closedNetwork: noClosedNetwork,
      lookup,
      cacheTtlMs: 30_000,
      now: () => clock,
    });

    expect((await resolver.connect('https://growi.example.com/')).ok).toBe(
      true,
    );

    clock += 30_001;
    // The name now points into a private range -- exactly the move that a
    // pairing-time-only judgement would never notice.
    expect(await resolver.connect('https://growi.example.com/')).toEqual({
      ok: false,
      reason: 'private-address',
    });
    expect(lookup.calls).toEqual(['growi.example.com', 'growi.example.com']);
  });
});

describe('buildPinnedRequestOptions', () => {
  const base = {
    uri: new URL('https://growi.example.com/'),
    request: { method: 'POST', path: '/_api/v3/x' },
    addresses: publicAddress,
    caCerts: [] as ReadonlyArray<string>,
    timeoutMs: 10_000,
  };

  it('keeps the URI hostname as the host, so SNI and certificate matching use the name and not the pinned address', () => {
    const options = buildPinnedRequestOptions(base);

    expect(options.host).toBe('growi.example.com');
    expect(options.path).toBe('/_api/v3/x');
    expect(options.method).toBe('POST');
  });

  it('hands the connection exactly the judged addresses, in both shapes node asks for', () => {
    const options = buildPinnedRequestOptions({
      ...base,
      addresses: [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      ],
    });

    const all = vi.fn();
    options.lookup?.('growi.example.com', { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);

    const single = vi.fn();
    options.lookup?.('growi.example.com', { all: false }, single);
    expect(single).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  });

  // A GROWI served under a path prefix is an ordinary deployment, and the
  // caller (`GrowiClient`, task 6.1) writes the API path alone -- the prefix is
  // the URI's to carry, not the caller's to repeat.
  it('keeps the prefix of a GROWI served under a path', () => {
    expect(
      buildPinnedRequestOptions({
        ...base,
        uri: new URL('https://growi.example.com/growi/'),
      }).path,
    ).toBe('/growi/_api/v3/x');
  });

  it('keeps the prefix even when the GROWI URI was written without a trailing slash', () => {
    expect(
      buildPinnedRequestOptions({
        ...base,
        uri: new URL('https://growi.example.com/growi'),
      }).path,
    ).toBe('/growi/_api/v3/x');
  });

  it('leaves the trust store alone when the operator declared no certificate', () => {
    expect('ca' in buildPinnedRequestOptions(base)).toBe(false);
  });

  it('trusts the operator-declared certificate for a closed-network destination', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----';

    expect(buildPinnedRequestOptions({ ...base, caCerts: [pem] }).ca).toEqual([
      pem,
    ]);
  });
});

describe('the connection handed back by connect()', () => {
  let server: Server | undefined;

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running != null) {
      running.closeAllConnections();
      await new Promise((resolve) => running.close(resolve));
    }
  });

  /**
   * A loopback server standing in for a closed-network GROWI: the operator
   * declared `growi.internal`, and the fake name resolution points it at
   * 127.0.0.1. Nothing leaves this process.
   */
  const startServer = async (
    handler: Parameters<typeof createServer>[1],
  ): Promise<number> => {
    server = createServer(handler);
    await new Promise<void>((resolve) =>
      server?.listen(0, '127.0.0.1', resolve),
    );
    return (server?.address() as AddressInfo).port;
  };

  const resolverForLoopback = (requestTimeoutMs?: number) =>
    createGrowiUriResolver({
      closedNetwork: closedNetwork(['growi.internal']),
      lookup: lookupReturning([{ address: '127.0.0.1', family: 4 }]),
      requestTimeoutMs,
    });

  it('connects to the judged address while still naming the host the URI wrote', async () => {
    const seen: Array<string | undefined> = [];
    const port = await startServer((req, res) => {
      seen.push(req.headers.host);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });

    const result = await resolverForLoopback().connect(
      `http://growi.internal:${port}/`,
    );
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    const response = await result.send({ method: 'GET', path: '/health' });

    expect(response.status).toBe(200);
    expect(response.body).toBe('{"ok":true}');
    // The pinned address carried the TCP connection; the hostname carried the
    // request -- the same split TLS relies on for certificate matching.
    expect(seen).toEqual([`growi.internal:${port}`]);
  });

  it('does not follow a redirect, handing the redirect itself back instead', async () => {
    const paths: string[] = [];
    const port = await startServer((req, res) => {
      paths.push(req.url ?? '');
      res.writeHead(302, {
        location: 'http://169.254.169.254/latest/meta-data',
      });
      res.end();
    });

    const result = await resolverForLoopback().connect(
      `http://growi.internal:${port}/`,
    );
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    const response = await result.send({ method: 'GET', path: '/redirect-me' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      'http://169.254.169.254/latest/meta-data',
    );
    expect(paths).toEqual(['/redirect-me']);
  });

  it('gives up on a destination that never answers', async () => {
    const port = await startServer(() => {
      // Never responds: the wait cap is the only thing that ends this request.
    });

    const result = await resolverForLoopback(80).connect(
      `http://growi.internal:${port}/`,
    );
    if (!result.ok) throw new Error(`refused: ${result.reason}`);

    await expect(
      result.send({ method: 'GET', path: '/hangs' }),
    ).rejects.toBeInstanceOf(GrowiRequestTimeoutError);
  });

  it('sends the body and headers it was given', async () => {
    const received: Array<{ body: string; auth?: string }> = [];
    const port = await startServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        received.push({
          body: Buffer.concat(chunks).toString('utf8'),
          auth: req.headers.authorization,
        });
        res.writeHead(201);
        res.end('created');
      });
    });

    const result = await resolverForLoopback().connect(
      `http://growi.internal:${port}/`,
    );
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    const response = await result.send({
      method: 'POST',
      path: '/_api/v3/notify',
      headers: { authorization: 'Signature keyid="k1"' },
      body: '{"hello":"world"}',
    });

    expect(response.status).toBe(201);
    expect(received).toEqual([
      { body: '{"hello":"world"}', auth: 'Signature keyid="k1"' },
    ]);
  });
});
