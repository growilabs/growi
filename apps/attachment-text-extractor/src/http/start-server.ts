import type { Hono } from 'hono';

export interface StartedServer {
  /** The port listened on; the one the OS picked when 0 was asked for. */
  readonly port: number;
  close(): Promise<void>;
}

export const startServer = (
  _app: Hono,
  _options: { readonly port: number; readonly hostname: string },
): Promise<StartedServer> =>
  Promise.reject(new Error('not implemented: http/start-server.startServer'));
