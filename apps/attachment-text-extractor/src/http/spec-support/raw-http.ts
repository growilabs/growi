import { connect } from 'node:net';

// A bare HTTP/1.x client over a TCP socket, for requests no HTTP library will
// send as written (declared lengths that lie, bodies that stall, duplicated
// headers, HTTP/1.0). Imports nothing from src/: the black-box tests use it
// against the Python service too.

export interface RawResponse {
  readonly status: number;
  /** Lower-cased names; a repeated header keeps its last value. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
  readonly text: string;
}

export interface RawConnection {
  /** Resolves false once the server has closed or reset the connection. */
  send(bytes: Uint8Array): Promise<boolean>;
  /**
   * The first final (non-1xx) response; null if the connection closes or the
   * time runs out first. `headOnly`: the answer to a HEAD request has no body.
   */
  response(timeoutMs: number, headOnly?: boolean): Promise<RawResponse | null>;
  /** Status codes of the interim (1xx) responses seen so far. */
  interim(): readonly number[];
  /** Sends our FIN; the server may still answer. */
  end(): void;
  destroy(): void;
}

export interface HostPort {
  readonly host: string;
  readonly port: number;
}

export const hostPortOf = (baseUrl: string): HostPort => {
  const url = new URL(baseUrl);
  return { host: url.hostname, port: Number(url.port) };
};

interface Parsed {
  /** null until the final response is complete. */
  readonly response: RawResponse | null;
  readonly interim: readonly number[];
}

const headerMap = (head: string): Record<string, string> =>
  Object.fromEntries(
    head
      .split('\r\n')
      .slice(1)
      .map((line) => {
        const colon = line.indexOf(':');
        return [
          line.slice(0, colon).trim().toLowerCase(),
          line.slice(colon + 1).trim(),
        ];
      }),
  );

const dechunk = (raw: Buffer): Buffer | null => {
  const pieces: Buffer[] = [];
  let at = 0;
  for (;;) {
    const lineEnd = raw.indexOf('\r\n', at);
    if (lineEnd === -1) return null;
    const size = Number.parseInt(raw.toString('latin1', at, lineEnd), 16);
    if (Number.isNaN(size)) return null;
    if (size === 0) return Buffer.concat(pieces);
    if (raw.length < lineEnd + 2 + size + 2) return null;
    pieces.push(raw.subarray(lineEnd + 2, lineEnd + 2 + size));
    at = lineEnd + 2 + size + 2;
  }
};

/** The interim (1xx) responses at the start of `raw` and the final response after them. */
const parse = (raw: Buffer, closed: boolean, headOnly = false): Parsed => {
  const interim: number[] = [];
  let rest = raw;
  for (;;) {
    const headEnd = rest.indexOf('\r\n\r\n');
    if (headEnd === -1) return { response: null, interim };
    const head = rest.toString('latin1', 0, headEnd);
    const status = Number(head.split(' ')[1]);
    const after = rest.subarray(headEnd + 4);
    if (status >= 100 && status < 200) {
      interim.push(status);
      rest = after;
      continue;
    }
    const headers = headerMap(head);
    let body: Buffer | null;
    if (headOnly) {
      body = Buffer.alloc(0);
    } else if (
      (headers['transfer-encoding'] ?? '').toLowerCase() === 'chunked'
    ) {
      body = dechunk(after);
    } else if (headers['content-length'] !== undefined) {
      const length = Number(headers['content-length']);
      body = after.length >= length ? after.subarray(0, length) : null;
    } else {
      body = closed ? after : null;
    }
    if (body === null) return { response: null, interim };
    return {
      response: { status, headers, body, text: body.toString('utf8') },
      interim,
    };
  }
};

/**
 * `allowHalfOpen`: keep our side open after the server ends its side, as a
 * client that never sends FIN does (the default ends ours in reply).
 */
export const openConnection = async (
  { host, port }: HostPort,
  options: { readonly allowHalfOpen?: boolean } = {},
): Promise<RawConnection> => {
  const socket = connect({
    host,
    port,
    allowHalfOpen: options.allowHalfOpen ?? false,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  let received = Buffer.alloc(0);
  let closed = false;
  const waiters = new Set<() => void>();
  const wake = (): void => {
    for (const waiter of waiters) waiter();
  };
  socket.on('data', (chunk: Buffer) => {
    received = Buffer.concat([received, chunk]);
    wake();
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    closed = true;
    wake();
  });
  socket.on('end', () => {
    closed = true;
    wake();
  });

  return {
    send: (bytes) =>
      new Promise((resolve) => {
        if (socket.destroyed || socket.writableEnded) {
          resolve(false);
          return;
        }
        socket.write(bytes, (error) => resolve(error == null));
      }),
    response: (timeoutMs, headOnly = false) =>
      new Promise((resolve) => {
        const check = (): void => {
          const { response } = parse(received, closed, headOnly);
          if (response !== null || closed) {
            done(response);
          }
        };
        const timer = setTimeout(() => done(null), timeoutMs);
        const done = (value: RawResponse | null): void => {
          clearTimeout(timer);
          waiters.delete(check);
          resolve(value);
        };
        waiters.add(check);
        check();
      }),
    interim: () => parse(received, closed).interim,
    end: () => socket.end(),
    destroy: () => socket.destroy(),
  };
};

/** Sends `bytes` on a fresh connection and returns the first final response (null if none came). */
export const sendRaw = async (
  target: HostPort,
  bytes: Uint8Array,
  timeoutMs = 10_000,
  headOnly = false,
): Promise<RawResponse | null> => {
  const connection = await openConnection(target);
  try {
    await connection.send(bytes);
    return await connection.response(timeoutMs, headOnly);
  } finally {
    connection.destroy();
  }
};

export interface RequestHeadOptions {
  readonly path?: string;
  readonly method?: string;
  readonly version?: '1.0' | '1.1';
  readonly token?: string | null;
  readonly contentType?: string;
  readonly contentLength?: number;
  readonly chunked?: boolean;
  readonly close?: boolean;
  readonly extra?: readonly string[];
}

/** The request line and headers, ending with the blank line. */
export const requestHead = (options: RequestHeadOptions): Buffer => {
  const lines = [
    `${options.method ?? 'POST'} ${options.path ?? '/extract'} HTTP/${options.version ?? '1.1'}`,
    'Host: test',
    ...(options.token == null
      ? []
      : [`Authorization: Bearer ${options.token}`]),
    ...(options.contentType === undefined
      ? []
      : [`Content-Type: ${options.contentType}`]),
    ...(options.contentLength === undefined
      ? []
      : [`Content-Length: ${options.contentLength}`]),
    ...(options.chunked === true ? ['Transfer-Encoding: chunked'] : []),
    ...(options.close === true ? ['Connection: close'] : []),
    ...(options.extra ?? []),
  ];
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'latin1');
};

/** One piece of a chunked body ("%x\r\n<bytes>\r\n"); an empty piece ends the body. */
export const chunk = (bytes: Uint8Array): Buffer =>
  Buffer.concat([
    Buffer.from(`${bytes.length.toString(16)}\r\n`, 'latin1'),
    Buffer.from(bytes),
    Buffer.from('\r\n', 'latin1'),
  ]);
